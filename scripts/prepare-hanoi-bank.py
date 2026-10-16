"""Prepare a private Hanoi question bank from current Pano review evidence.
Reads the Pano database only. Writes no patient images or answers into dist/Git.
"""
import argparse,collections,hashlib,json,sqlite3,time
from pathlib import Path
from pano.store import Store
from pano.collaboration import package_image,reservation_groups
from pano.caries import CariesData
from pano.finding_data import coverage
from pano.paths import ROOT

def prepare(db_path,out):
    out=Path(out).resolve()
    if not out.is_relative_to(ROOT.resolve()):raise ValueError("Output must stay inside F:/pano")
    st=Store.__new__(Store)
    st.db=sqlite3.connect("file:"+Path(db_path).as_posix()+"?mode=ro",uri=True)
    st.db.row_factory=sqlite3.Row
    images=st.images();groups=reservation_groups(images)
    locks={r[0] for r in st.db.execute("SELECT image_id FROM collaboration_locks")}
    blocked={groups[i] for i in locks}
    nontrain={groups[i["id"]] for i in images if i["split"]!="train"}
    touched={r[0] for r in st.db.execute("SELECT DISTINCT image_id FROM human_review_events")}
    # Include explicit scope reviews even if legacy history has not been migrated.
    for im in images:
        if any(r.get("actor")=="human" for r in im["metadata"].get("finding_reviews",{}).values()):
            touched.add(im["id"])
    full={r[0] for r in st.db.execute("SELECT DISTINCT image_id FROM human_review_events WHERE scope='all' AND action='review_complete'")}
    histgroups={groups[i] for i in touched if i in groups}
    car=CariesData.__new__(CariesData);car.st=st;car.owns=False
    cases=[];seen=set();counts=collections.Counter();excluded=[]
    for im in sorted(images,key=lambda x:(x["id"] not in full,x["id"])):
        if im["source"]!="hanoi":continue
        iid=im["id"];g=groups[iid]
        reason=None
        if im["split"]!="train" or g in nontrain:reason="evaluation_or_cross_split"
        elif g in blocked:reason="friend_assignment"
        elif g in seen:reason="same_original_or_patient"
        if reason:counts[reason]+=1;continue
        refs=None;version=None;kind="unscored"
        if iid in full:
            aa=st.annotations(iid);cr=car.load(iid)
            if not cr["complete"] or not all(coverage(im,aa,r)[0] for r in ("findings","hanoi")):
                counts["stale_or_incomplete_review"]+=1;excluded.append(iid);continue
            item=package_image(st,iid);refs=[];boxkeys=set()
            for box in item["boxes"]:
                if box["status"]=="excluded":continue
                if box["status"]!="confirmed":raise ValueError("Unconfirmed reference: "+iid)
                b={k:box[k] for k in ("category","geometry","bbox")}
                signature=json.dumps(b,sort_keys=True)
                if signature in boxkeys:counts["exact_duplicate_reference_box"]+=1;continue
                boxkeys.add(signature);b["id"]=box["id"].replace(":","-")
                b["finding_id"]=b["id"];refs.append(b)
            kind="verified";version=hashlib.sha256(json.dumps(refs,sort_keys=True).encode()).hexdigest()[:20]
        elif g in histgroups:
            counts["partial_review_history"]+=1;continue
        path=(ROOT/im["path"]).resolve()
        if not path.is_relative_to(ROOT.resolve()) or not path.is_file():raise ValueError("Missing original image")
        seen.add(g)
        cases.append({"id":iid,"group_id":g,"object_key":"lod/hanoi/"+iid+".png","width":im["width"],"height":im["height"],
          "scope":["caries_ungraded","deep_caries","periapical_lesion","impacted_tooth"],"reference":refs,
          "reference_version":version,"explanation":None,"attribution":"Hanoi panoramic radiographs · Mendeley Data v3 · https://data.mendeley.com/datasets/kx52tk2ddj/3",
          "license":"CC BY 4.0","source":"hanoi","kind":kind,"quality_reviewed_by":"owner" if kind=="verified" else None,
          "created_at":int(time.time()),"local_image":str(path),"pixel_hash":im["pixel_hash"],"split":"train"})
        counts[kind]+=1
    st.close()
    manifest={"schema":"lod-question-bank-v1","created_at":int(time.time()),"source_db":str(db_path),"cases":cases,
      "policy":{"scored_per_free_set":3,"unscored_per_free_set":7,"training_min_score":50,"unscored_assignments_per_image":1,"review_required_before_training":True},
      "audit":{"counts":dict(counts),"excluded_stale_ids":excluded,"human_full_review_history":len(full),"files_copied":0}}
    out.mkdir(parents=True,exist_ok=True)
    target=out/"manifest.json";tmp=out/"manifest.json.tmp";tmp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8");tmp.replace(target)
    (out/"audit.json").write_text(json.dumps(manifest["audit"],ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"manifest":str(target),"audit":manifest["audit"]},ensure_ascii=True))
    return manifest

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",default=str(ROOT/"data/pano.sqlite3"));p.add_argument("--out",default=str(ROOT/"league/hanoi-bank"))
    a=p.parse_args();prepare(a.db,a.out)
