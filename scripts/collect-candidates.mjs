// Owner-only local collection. Never imports labels, confirms them, or launches training.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Game from '../dist/game-core.js';
const root=path.resolve('F:/pano');
function inside(p){p=path.resolve(p);const rel=path.relative(root,p);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Files must stay inside F:/pano');return p;}
function atomic(filename,data){fs.mkdirSync(path.dirname(filename),{recursive:true});const temp=filename+'.tmp',fd=fs.openSync(temp,'w');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,filename);}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function collectCandidates(bundle,manifest,directory){
 const out=inside(directory);if(bundle.schema!=='lod-training-candidates-v1'||manifest.schema!=='lod-question-bank-v1'||!Array.isArray(bundle.candidates))throw Error('Invalid candidate export or image manifest');
 const sources=new Map(manifest.cases.map(c=>[c.id,c])),seen=new Set();
 // Validate everything before modifying the collection.
 const records=bundle.candidates.map(c=>{
  const source=sources.get(c.case_id);if(!source||source.kind!=='unscored'||source.split!=='train'||source.width!==c.width||source.height!==c.height||source.group_id!==c.group_id||source.object_key!==c.object_key||source.source!==c.source)throw Error('Image provenance mismatch: '+c.case_id);
  if(!Number.isFinite(c.validation_score)||!Number.isFinite(c.quality_threshold)||c.validation_score<c.quality_threshold||c.training_ready!==false||c.review_state!=='candidate_needs_review')throw Error('Candidate quality gate or review state failed');
  if(!c.round_id||!c.user_id||!Object.keys(Game.coordinateSystem).every(k=>c.coordinate_system?.[k]===Game.coordinateSystem[k]))throw Error('Invalid candidate identity or coordinates');
  const scope=c.scope_json?JSON.parse(c.scope_json):source.scope;
  if(!Array.isArray(scope)||scope.some(x=>!source.scope.includes(x))||(Game.timedVersions.includes(c.rule_version)&&(scope.length!==2||Game.labelCategories.some(x=>!scope.includes(x)))))throw Error('Candidate label scope mismatch');
  const boxes=Game.boxes(c.boxes,{...source,scope}),id=crypto.createHash('sha256').update(c.round_id+'\0'+c.case_id).digest('hex');if(seen.has(id))throw Error('Duplicate candidate in export');seen.add(id);
  const image=inside(source.local_image);
  return {...c,candidate_id:id,boxes,auto_submitted:!!c.auto_submitted,unmarked_regions:c.auto_submitted?'unknown':'reviewed_within_scope',coverage:c.auto_submitted?'partial':'complete_for_scope',local_image:image,image_available:fs.existsSync(image),split:'train',license:source.license,attribution:source.attribution,pixel_hash:source.pixel_hash,review_state:'candidate_needs_review',training_ready:false};
 });
 fs.mkdirSync(path.join(out,'reviews'),{recursive:true});let added=0,updated=0;
 const entries=records.map(c=>{
  const file='candidates/'+c.candidate_id+'.json',full=path.join(out,file),json=JSON.stringify(c,null,2)+'\n';
  if(!fs.existsSync(full)){atomic(full,json);added++;}else if(fs.readFileSync(full,'utf8')!==json){atomic(full,json);updated++;}
  return {candidate_id:c.candidate_id,case_id:c.case_id,file,local_image:c.local_image,image_available:c.image_available,validation_score:c.validation_score,box_count:c.boxes.length,auto_submitted:c.auto_submitted,coverage:c.coverage,review_state:'candidate_needs_review',training_ready:false};
 });
 const index={schema:'lod-collected-candidates-v1',collected_at:new Date().toISOString(),source_export_created_at:bundle.created_at,auto_training:false,active_candidate_count:entries.length,new_candidates:added,updated_candidates:updated,candidates:entries};
 atomic(path.join(out,'latest.json'),JSON.stringify(index,null,2)+'\n');
 const snapshot=index.collected_at.replace(/[:.]/g,'-')+'.json';atomic(path.join(out,'snapshots',snapshot),JSON.stringify(bundle,null,2)+'\n');
 const rows=entries.map(c=>`<tr><td>${escape(c.case_id)}</td><td>${c.validation_score.toFixed(1)}%</td><td>${c.box_count}</td><td>${c.auto_submitted?'시간 초과 · 미표시 영역 미검토':'검수 대기'}</td><td><a href="${c.file}">라벨 JSON</a> · <a href="${escape(new URL('file:///'+c.local_image.replaceAll('\\','/')).href)}">원본 영상</a>${c.image_available?'':' · 원본 경로 확인 필요'}</td></tr>`).join('');
 const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>League of Doctors · 수집한 학습 후보</title><style>body{font:16px/1.7 system-ui;background:#101217;color:#e5e7ed;max-width:1100px;margin:45px auto;padding:0 25px}h1{font-size:30px}a{color:#a8c9ff}.card{padding:22px;background:#1b202a;border:1px solid #353c49;border-radius:12px;margin:20px 0}b{color:#a9e5c1}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #333}small{color:#a8b0bc}</style><h1>수집한 학습 후보</h1><p>마지막 수집: ${escape(new Date(index.collected_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} (한국시간)</p><div class="card"><b>현재 후보 ${entries.length}장 · 이번에 새로 받은 자료 ${added}장</b><p>합격은 세트별 기준입니다. 검증 점수가 해당 세트의 기준(기본 50점) 이상인 경우에만 미검토 7장의 답안이 포함됩니다.</p><strong>자동 학습 · 자동 확정은 하지 않습니다.</strong></div><ol><li>F:\\pano\\합격라벨_가져오기.cmd를 더블클릭하면 최신 후보를 다시 받습니다.</li><li>아래 라벨과 원본 영상을 함께 검수하세요. 후보는 원본 픽셀 좌표의 박스이며 윤곽 마스크가 아닙니다.</li><li>검수 후 선택한 자료로 새 학습 버전을 시작합니다. 이 수집 도구는 기존 Pano 라벨·학습 데이터셋을 변경하지 않습니다.</li></ol><p>같은 답안을 여러 번 받아도 후보 파일은 중복 생성되지 않습니다. <a href="latest.json">현재 목록</a> · <a href="candidates/">후보 폴더</a> · <a href="snapshots/">수집 시점별 원본</a></p><p><small>검수 기록은 reviews 폴더에 별도로 보관하세요. 다시 내려받아도 이 폴더는 수정하지 않습니다. 현재 목록에서 사라진 과거 파일은 보관용이며 학습 대상에 자동 포함되지 않습니다.</small></p><table><thead><tr><th>영상</th><th>검증 점수</th><th>박스 수</th><th>상태</th><th>열기</th></tr></thead><tbody>${rows||'<tr><td colspan="5">아직 기준을 통과한 완료 답안이 없습니다. 참가자가 세트를 마친 후 다시 수집하세요.</td></tr>'}</tbody></table></html>`;
 atomic(path.join(out,'index.html'),html);return {collected:entries.length,added,updated,index:path.join(out,'latest.json'),report:path.join(out,'index.html'),auto_training:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{const [input,manifest,out]=process.argv.slice(2);console.log(JSON.stringify(collectCandidates(JSON.parse(fs.readFileSync(inside(input),'utf8')),JSON.parse(fs.readFileSync(inside(manifest),'utf8')),out||path.join(root,'league/collected'))));}catch(e){console.error(e.message);process.exitCode=1;}
