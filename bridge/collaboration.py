"""Offline assignment packages and transactional, conflict-checked box returns."""
from copy import deepcopy
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
import hashlib,json,math,os,uuid,zipfile
from .paths import ROOT,inside
from .io import now,read_json
from .caries import CariesData,scoped_signature,fingerprint
from .finding_data import relevant,coverage,signature,public_reference
from .duplicates import original_film_groups

ROLE={"caries_ungraded":"caries","deep_caries":"findings","impacted_tooth":"findings","periapical_lesion":"hanoi"}
GEOMETRY={"caries_ungraded":"lesion_box","deep_caries":"tooth_box","impacted_tooth":"tooth_box","periapical_lesion":"lesion_box"}
PERMIT=ContextVar("pano_assignment",default=None)
def encode(x):return json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(",",":"))
def digest(x):return hashlib.sha256(encode(x).encode()).hexdigest()
def setup(st):
    CariesData(st)
    from .review_history import ReviewHistory
    ReviewHistory(st)
    st.db.executescript("""
    CREATE TABLE IF NOT EXISTS collaboration_packages(id TEXT PRIMARY KEY,actor TEXT,state TEXT,record TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS collaboration_locks(image_id TEXT PRIMARY KEY,package_id TEXT,actor TEXT);
    CREATE TABLE IF NOT EXISTS collaboration_returns(id TEXT PRIMARY KEY,package_id TEXT,record TEXT,created TEXT);
    """)
def assert_editable(st,iid):
    if not st.db.execute("SELECT 1 FROM sqlite_master WHERE name='collaboration_locks'").fetchone():return
    r=st.db.execute("SELECT package_id,actor FROM collaboration_locks WHERE image_id=?",(iid,)).fetchone()
    if r and r[0]!=PERMIT.get():raise ValueError(f"{r[1]}에게 배정된 영상입니다. 협업 탭에서 반환 결과를 가져오거나 배정을 취소하세요.")
@contextmanager
def permit(pid):
    t=PERMIT.set(pid)
    try:yield
    finally:PERMIT.reset(t)
def raw_state(st,iid):
    im=st.image(iid);im.pop("assignment",None)
    row=st.db.execute("SELECT record FROM caries_workspaces WHERE image_id=?",(iid,)).fetchone()
    return {"image":im,"annotations":st.annotations(iid),"workspace":json.loads(row[0]) if row else None}
def workspace(st):
    obj=CariesData.__new__(CariesData);obj.st=st;obj.owns=False;return obj

def status(st,iid):
    im=st.image(iid);aa=st.annotations(iid)
    return {"caries":bool(workspace(st).load(iid)["complete"]),
            **{r:coverage(im,aa,r)[0] for r in ("findings","hanoi")}}
def package_image(st,iid):
    im=st.image(iid);aa=st.annotations(iid);cr=workspace(st).load(iid)
    if cr.get("stale"):raise ValueError("충치 작업이 오래된 영상입니다. 기존 윤곽→박스 갱신 후 다시 배정하세요: "+iid)
    boxes=[]
    for b in cr["boxes"]:
        boxes.append({"id":"c:"+b["id"],"category":"caries_ungraded","geometry":"lesion_box",
                      "bbox":b["bbox"],"status":b["status"],"locked":False,"source":b.get("origin_source","user"),
                      "confidence":b.get("confidence")})
    for a in relevant(aa,"findings")+relevant(aa,"hanoi"):
        boxes.append({"id":"a:"+a["id"],"category":a["category"],"geometry":GEOMETRY[a["category"]],
                      "bbox":a["bbox"],"status":"confirmed" if public_reference(a) else a["status"],
                      "locked":bool(a["mask_path"]),"source":a["source"],
                      "confidence":a["metadata"].get("detection_score")})
    original=im["metadata"].get("original","")
    return {"id":iid,"name":str(original).replace("\\","/").split("/")[-1] or iid,
            "source":im["source"],"split":im["split"],"width":im["width"],"height":im["height"],
            "file":"images/"+iid+".png","boxes":boxes,"review":status(st,iid),"needs_review":False,
            "base":digest(raw_state(st,iid))}
def reservation_groups(images):
    films=original_film_groups(images);parent={i["id"]:i["id"] for i in images}
    def find(x):
        while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
        return x
    groups={}
    for im in images:
        for key in (("patient",im["group_id"]),("film",films[im["id"]])):
            if key in groups:parent[find(im["id"])]=find(groups[key])
            else:groups[key]=im["id"]
    return {iid:find(iid) for iid in parent}

def list_packages(st):
    setup(st)
    return [dict(r) for r in st.db.execute("SELECT id,actor,state,created FROM collaboration_packages ORDER BY created DESC")]
def cancel(st,pid):
    setup(st)
    with st.db:
        st.db.execute("UPDATE collaboration_packages SET state='cancelled' WHERE id=? AND state!='completed'",(pid,))
        st.db.execute("DELETE FROM collaboration_locks WHERE package_id=?",(pid,))
def create_package(st,actor,count=50,source="hanoi",split="train",predict=True,editor_url=""):
    setup(st);actor=str(actor).strip()
    if not actor or len(actor)>80 or not 1<=count<=200:raise ValueError("이름과 1~200장 분량을 지정하세요.")
    if split not in ("train","val","test"):raise ValueError("Invalid split")
    if editor_url and not editor_url.startswith("https://"):raise ValueError("웹 주소는 https://로 시작해야 합니다.")
    pid=uuid.uuid4().hex;images=st.images();groups=reservation_groups(images)
    blocked={r[0] for r in st.db.execute("SELECT image_id FROM collaboration_locks")}
    selected=[];reserved=set()
    from .review_ui import image_order
    st.db.execute("BEGIN IMMEDIATE")
    try:
        # Re-read locks under the writer lock to prevent simultaneous assignments.
        blocked={r[0] for r in st.db.execute("SELECT image_id FROM collaboration_locks")}
        for im in sorted(images,key=image_order):
            if im["source"]!=source or im["split"]!=split or im["id"] in blocked|reserved:continue
            group={x["id"] for x in images if groups[x["id"]]==groups[im["id"]]}
            if group & (blocked|reserved):continue
            if all(status(st,im["id"]).values()):continue
            selected.append(im["id"]);reserved.update(group)
            if len(selected)>=count:break
        if not selected:raise ValueError("배정 가능한 미완료 영상이 없습니다.")
        st.db.execute("INSERT INTO collaboration_packages VALUES(?,?,?,?,?)",(pid,actor,"preparing","{}",now()))
        st.db.executemany("INSERT INTO collaboration_locks VALUES(?,?,?)",[(iid,pid,actor) for iid in reserved])
        st.db.commit()
    except Exception:st.db.rollback();raise
    out=inside(ROOT/"collaboration"/"outbox"/(pid+".zip"));out.parent.mkdir(parents=True,exist_ok=True)
    tmp=out.with_suffix(".partial")
    try:
        options=[]
        if predict:
            from .targeted_prediction import automatic_options,_targeted_predict,_manifests
            from .locking import gpu_operation
            options=automatic_options()
            manifests=_manifests()
            for option in options:
                option["inference_settings"]={role:{key:manifests[mid].get(key) for key in ("size","confidence_threshold","confidence_by_class","nms_iou_threshold")} for role,mid in option["model_ids"].items()}
            if set(o["category"] for o in options)!=set(ROLE):raise ValueError("네 가지 병소의 활성 모델을 먼저 준비하세요.")
            @gpu_operation
            def infer_all():
                with permit(pid):
                    for iid in selected:
                        if st.db.execute("SELECT state FROM collaboration_packages WHERE id=?",(pid,)).fetchone()[0]!="preparing":raise ValueError("배정이 취소되었습니다.")
                        cache={}
                        for o in sorted(options,key=lambda x:x["destination"]=="caries"):
                            _targeted_predict(iid,o["id"],inference_cache=cache)
            infer_all()
        manifest={"format":"pano-work","version":1,"package_id":pid,"actor":actor,"created":now(),
                  "token":uuid.uuid4().hex,"editor_url":editor_url,"models":options,
                  "images":[package_image(st,iid) for iid in selected]}
        with zipfile.ZipFile(tmp,"w",compression=zipfile.ZIP_STORED,allowZip64=False) as z:
            z.writestr("labels.json",encode(manifest))
            z.writestr("START.txt","Pano 공동 라벨링\n"+(editor_url+"\n" if editor_url else "")+
                       "압축을 푼 뒤 index.html을 열거나 위 웹 주소에 접속하세요.\n작업 ZIP 열기에서 이 ZIP을 선택하세요. 수정 후 결과 JSON을 담당자에게 보내세요.\n영상과 AI 초안은 브라우저 안에서 처리됩니다.\n")
            web=Path(__file__).resolve().parents[2]/"collab-web"/"dist"
            for name in ("index.html","style.css","app.js","core.js","zip.js"):
                z.write(web/name,name)
            for im in manifest["images"]:z.write(inside(ROOT/st.image(im["id"])["path"]),im["file"])
        with zipfile.ZipFile(tmp) as z:
            if z.testzip():raise ValueError("ZIP integrity failed")
        os.replace(tmp,out)
        if st.db.execute("SELECT state FROM collaboration_packages WHERE id=?",(pid,)).fetchone()[0]!="preparing":raise ValueError("배정이 취소되었습니다.")
        for im in manifest["images"]:
            if digest(raw_state(st,im["id"]))!=im["base"]:raise ValueError("ZIP 생성 중 원본 수정 감지. 다시 배정하세요.")
        with st.db:st.db.execute("UPDATE collaboration_packages SET state='exported',record=? WHERE id=?",(encode(manifest),pid))
        return {"package_id":pid,"path":str(out),"images":len(selected),"actor":actor,"size_mb":round(out.stat().st_size/1e6,1)}
    except Exception:
        with st.db:
            st.db.execute("UPDATE collaboration_packages SET state='failed' WHERE id=? AND state='preparing'",(pid,))
            st.db.execute("DELETE FROM collaboration_locks WHERE package_id=?",(pid,))
        raise
def validate_result(manifest,result):
    if result.get("format")!="pano-result" or result.get("version")!=1:raise ValueError("지원하지 않는 결과 형식")
    if result.get("package_id")!=manifest["package_id"] or result.get("token")!=manifest["token"]:raise ValueError("다른 배정 작업의 결과입니다.")
    originals={im["id"]:im for im in manifest["images"]};seen=set()
    returned=result.get("images")
    if not isinstance(returned,list) or len(returned)>len(originals):raise ValueError("영상 목록 오류")
    for im in returned:
        iid=im.get("id")
        if iid not in originals or iid in seen:raise ValueError("잘못되거나 중복된 영상 ID")
        seen.add(iid);base=originals[iid]
        if im.get("base")!=base["base"]:raise ValueError("원본 버전 불일치")
        if type(im.get("needs_review")) is not bool:raise ValueError("검토 요청 상태 누락")
        if set(im.get("review",{}))!=set(("caries","findings","hanoi")) or any(type(v) is not bool for v in im["review"].values()):raise ValueError("소견별 검토 상태 오류")
        old={b["id"]:b for b in base["boxes"]};ids=set()
        if not isinstance(im.get("boxes"),list) or len(im["boxes"])>2000:raise ValueError("박스 목록 오류")
        for b in im["boxes"]:
            bid=b.get("id");cat=b.get("category")
            if not isinstance(bid,str) or len(bid)>100 or bid in ids:raise ValueError("중복/잘못된 박스 ID")
            ids.add(bid)
            if bid not in old and (not bid.startswith("new:") or len(bid)<10):raise ValueError("새 박스 ID 오류")
            if cat not in ROLE or b.get("geometry")!=GEOMETRY[cat]:raise ValueError("병소/치아 박스 의미 오류")
            xy=b.get("bbox",[])
            if len(xy)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) for v in xy):raise ValueError("좌표 오류")
            if not (0<=xy[0]<xy[2]<=base["width"] and 0<=xy[1]<xy[3]<=base["height"]):raise ValueError("영상 밖 좌표")
            if b.get("status") not in ("draft","editing","confirmed","excluded"):raise ValueError("확정 상태 오류")
            if bid in old:
                ob=old[bid]
                if cat!=ob["category"] or b["geometry"]!=ob["geometry"]:raise ValueError("기존 라벨 의미는 변경할 수 없습니다. 제외 후 새로 추가하세요.")
                if ob["locked"] and xy!=ob["bbox"]:raise ValueError("정밀 원본 윤곽의 박스 변경 금지")
            if im["review"][ROLE[cat]] and b["status"] not in ("confirmed","excluded"):raise ValueError("미확정 박소가 있는 소견의 검토 완료 금지")
        if not set(old)<=ids:raise ValueError("기존 박스가 누락됐습니다. 삭제 대신 제외를 사용하세요.")
        events=im.get("history",[])
        if not isinstance(events,list) or len(encode(events))>2_000_000:raise ValueError("수정 이력 크기 오류")
    return originals
def import_result(st,path):
    setup(st);path=Path(path)
    if path.stat().st_size>40_000_000:raise ValueError("결과 파일이 너무 큽니다.")
    result=json.loads(path.read_text(encoding="utf-8"));rid=digest(result);pid=result.get("package_id")
    prior=st.db.execute("SELECT record FROM collaboration_returns WHERE id=?",(rid,)).fetchone()
    if prior:return {"duplicate":True,**json.loads(prior[0])}
    row=st.db.execute("SELECT record,state FROM collaboration_packages WHERE id=?",(pid,)).fetchone()
    if not row or row[1] not in ("exported","completed"):raise ValueError("유효한 배정 작업이 아닙니다.")
    manifest=json.loads(row[0]);bases=validate_result(manifest,result)
    st.db.execute("BEGIN IMMEDIATE")
    try:
        accepted=[];conflicts=[];unchanged=[]
        for returned in result["images"]:
            iid=returned["id"];base=bases[iid]
            old={b["id"]:b for b in base["boxes"]}
            changed=any(b["id"] not in old or any(b[k]!=old[b["id"]][k] for k in ("bbox","status")) for b in returned["boxes"])
            changed=changed or returned["review"]!=base["review"] or returned["needs_review"] or bool(returned.get("history"))
            if not changed:unchanged.append(iid);continue
            applied=manifest.setdefault("applied",{}).get(iid)
            if applied==digest(returned):unchanged.append(iid);continue
            lock=st.db.execute("SELECT package_id FROM collaboration_locks WHERE image_id=?",(iid,)).fetchone()
            if not lock or lock[0]!=pid or digest(raw_state(st,iid))!=base["base"]:
                conflicts.append(iid);continue
            changed_scopes={ROLE[b["category"]] for b in returned["boxes"] if b["id"] not in old or any(b[k]!=old[b["id"]][k] for k in ("bbox","status"))}
            explicit=set()
            for event in returned.get("history",[]):
                if not isinstance(event,dict):continue
                action=event.get("action")
                if action=="complete_all":explicit.update(("caries","findings","hanoi"))
                elif action in ("complete_caries","complete_findings","complete_hanoi"):explicit.add(action[9:])
            human_scopes=changed_scopes|explicit|{r for r in returned["review"] if returned["review"][r]!=base["review"][r]}
            stamp=now();im=st.image(iid);aa=st.annotations(iid);cr=CariesData.__new__(CariesData);cr.st=st;cr.owns=False
            record=cr.load(iid);cby={b["id"]:deepcopy(b) for b in record["boxes"]};caries_changed=False
            for b in returned["boxes"]:
                bid=b["id"];ob=old.get(bid)
                if ob and all(b[k]==ob[k] for k in ("bbox","status")):continue
                info={"package_id":pid,"actor":manifest["actor"],"imported_at":stamp,"web_box_id":bid}
                if ROLE[b["category"]]=="caries":
                    cid=bid[2:] if bid.startswith("c:") else "web-"+hashlib.sha256((pid+iid+bid).encode()).hexdigest()[:24]
                    v=cby.get(cid,{"id":cid,"origin_source":"user"})
                    v.update(bbox=b["bbox"],status=b["status"],human_modified=True,collaboration=info);cby[cid]=v;caries_changed=True
                else:
                    if bid.startswith("a:"):
                        a=deepcopy(st.annotation(bid[2:]));a["revision"]+=1
                    else:
                        aid="web-"+hashlib.sha256((pid+iid+bid).encode()).hexdigest()[:24]
                        a={"id":aid,"image_id":iid,"category":b["category"],"geometry":b["geometry"],"quality":"box",
                           "source":"user","raw_label":None,"revision":1,"mask_path":None,"metadata":{}}
                    a.update(bbox=b["bbox"],status=b["status"],updated=stamp)
                    if not a["mask_path"]:a["quality"]="box"
                    a["metadata"].update(collaboration=info,human_reviewed_box=b["status"]=="confirmed",last_operation="collaboration")
                    cols=["id","image_id","category","geometry","quality","status","source","raw_label","revision","mask_path","bbox","metadata","updated"]
                    vals=[encode(a[k]) if k in ("bbox","metadata") else a[k] for k in cols]
                    st.db.execute("INSERT OR REPLACE INTO annotations VALUES("+",".join("?" for _ in cols)+")",vals)
                    st.db.execute("INSERT INTO revisions VALUES(?,?,?,?)",(a["id"],a["revision"],encode(a),stamp))
            if caries_changed or returned["review"]["caries"]!=base["review"]["caries"] or returned["needs_review"]:
                record.update(boxes=list(cby.values()),revision=record["revision"]+1,complete=returned["review"]["caries"] and not returned["needs_review"],
                              completion_source="human_caries_review" if returned["review"]["caries"] and not returned["needs_review"] else None,
                              scoped_signature=scoped_signature(im,st.annotations(iid)),base_fingerprint=fingerprint(im,st.annotations(iid)),
                              stale=False,updated=stamp,last_operation="collaboration",collaboration={"actor":manifest["actor"],"package_id":pid})
                st.db.execute("INSERT OR REPLACE INTO caries_workspaces VALUES(?,?,?)",(iid,record["revision"],encode(record)))
                st.db.execute("INSERT INTO caries_workspace_revisions VALUES(?,?,?,?)",(iid,record["revision"],encode(record),stamp))
            meta=im["metadata"];meta["review_dirty"]=True
            reviews=meta.setdefault("finding_reviews",{});aa=st.annotations(iid)
            for role in ("findings","hanoi"):
                if returned["review"][role] and not returned["needs_review"]:
                    reviews[role]={"signature":signature(aa,role),"reviewed_at":stamp,"scope":role,"actor":manifest["actor"] if role in human_scopes else "preserved_reference_coverage",
                                   "negative":not any(a["status"]!="excluded" for a in relevant(aa,role))}
                else:reviews.pop(role,None)
            meta["collaboration_review"]={"actor":manifest["actor"],"package_id":pid,"needs_review":returned["needs_review"],"at":stamp}
            st.db.execute("UPDATE images SET fully_reviewed=0,metadata=? WHERE id=?",(encode(meta),iid))
            st.db.execute("INSERT INTO events(kind,record,created) VALUES(?,?,?)",("collaboration_return",encode({"image_id":iid,"actor":manifest["actor"],"package_id":pid,"history":returned.get("history",[]),"review":returned["review"]}),stamp))
            for scope in sorted(human_scopes):
                action="review_complete" if returned["review"][scope] and not returned["needs_review"] else "edited"
                st.db.execute("INSERT OR IGNORE INTO human_review_events VALUES(?,?,?,?,?,?,?)",
                    (rid+":"+iid+":"+scope,iid,scope,action,encode({"actor":manifest["actor"],"provenance":"collaboration_return","package_id":pid}),stamp,stamp))
            manifest["applied"][iid]=digest(returned);accepted.append(iid)
        done=len(manifest.get("applied",{}))==len(manifest["images"])
        st.db.execute("UPDATE collaboration_packages SET record=?,state=? WHERE id=?",(encode(manifest),"completed" if done else "exported",pid))
        # Returned images become editable locally. Later changes require a new assignment.
        images=st.images();groups=reservation_groups(images)
        for iid in accepted:
            im=st.image(iid)
            related=[x["id"] for x in images if groups[x["id"]]==groups[iid]]
            st.db.executemany("DELETE FROM collaboration_locks WHERE package_id=? AND image_id=?",[(pid,x) for x in related])
        report={"package_id":pid,"accepted":accepted,"conflicts":conflicts,"unchanged":unchanged}
        st.db.execute("INSERT INTO collaboration_returns VALUES(?,?,?,?)",(rid,pid,encode(report),now()))
        st.db.commit()
        return report
    except Exception:st.db.rollback();raise
