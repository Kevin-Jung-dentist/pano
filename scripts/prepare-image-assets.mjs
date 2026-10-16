// Stage unchanged PNGs outside Git, using same-volume hard links (no extra image copies).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {compileBank} from './bank.mjs';
const root='F:/pano';
function inside(value){const p=path.resolve(value),rel=path.relative(root,p);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('All paths must stay inside F:/pano');return p;}
export function prepareImages(input){
 const manifestPath=inside(input),m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));const built=compileBank(m);
 if(m.cases.length>20000)throw Error('Free asset file limit exceeded');
 const digest=crypto.createHash('sha256').update(JSON.stringify(m.cases)).digest('hex');
 const dir=inside(path.join(root,'league/image-assets',digest)),files=[];fs.mkdirSync(dir,{recursive:true});let bytes=0;
 // Keep previously published image paths for old assignments and result feedback.
 const previousPath=path.join(path.dirname(manifestPath),'asset-integrity.json');
 const previous=fs.existsSync(previousPath)?JSON.parse(fs.readFileSync(previousPath,'utf8')):null;
 const previousDirectory=previous?.asset_directory||(previous?.config&&fs.existsSync(previous.config)?JSON.parse(fs.readFileSync(previous.config,'utf8')).assets.directory:null);
 const currentKeys=new Set(m.cases.map(c=>c.object_key));
 if(previousDirectory)for(const old of previous.files){
  if(currentKeys.has(old.key))continue;
  if(!/^lod\/hanoi\/[a-zA-Z0-9_-]+\.png$/.test(old.key))throw Error('Invalid previous asset key');
  const source=inside(path.join(previousDirectory,old.key)),data=fs.readFileSync(source);
  if(crypto.createHash('sha256').update(data).digest('hex')!==old.sha256)throw Error('Previously published image changed');
  const dest=inside(path.join(dir,old.key));fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.linkSync(source,dest);
  files.push(old);bytes+=old.bytes;
 }
 if(files.length+m.cases.length>20000)throw Error('Free asset file limit exceeded, including old assignments');
 for(const c of m.cases){
  const src=inside(c.local_image),data=fs.readFileSync(src);
  if(data.length>25*1024*1024||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||data.readUInt32BE(16)!==c.width||data.readUInt32BE(20)!==c.height)throw Error('Invalid PNG or dimensions: '+c.id);
  const sha256=crypto.createHash('sha256').update(data).digest('hex'),dest=inside(path.join(dir,c.object_key));fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(!fs.existsSync(dest))fs.linkSync(src,dest);
  else if(crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==sha256)throw Error('Staged asset changed: '+c.id);
  files.push({id:c.id,key:c.object_key,bytes:data.length,sha256});bytes+=data.length;
 }
 const config={name:'pano-images',account_id:'47a07b06de2023339959dc87e4cebb7f',main:fileURLToPath(new URL('../server/image-worker.mjs',import.meta.url)),compatibility_date:'2026-10-16',workers_dev:false,preview_urls:false,routes:[],assets:{directory:dir,binding:'ASSETS',run_worker_first:true,html_handling:'none',not_found_handling:'none'},vars:{APP_ORIGIN:'https://pano-9kh.pages.dev'},d1_databases:[{binding:'DB',database_name:'pano-game',database_id:'0146b254-6425-4604-ad93-aaf7022bbf52'}]};
 const out=path.dirname(manifestPath),configPath=path.join(out,'images.wrangler.json');fs.writeFileSync(configPath,JSON.stringify(config,null,2));
 fs.writeFileSync(path.join(out,'asset-integrity.json'),JSON.stringify({digest,files,bytes,config:configPath,asset_directory:dir},null,2));fs.writeFileSync(path.join(out,'bank.sql'),built.sql);
 return {files:files.length,bytes,counts:built.counts,config:configPath,asset_directory:dir};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{console.log(JSON.stringify(prepareImages(process.argv[2])));}catch(e){console.error(e.message);process.exitCode=1;}
