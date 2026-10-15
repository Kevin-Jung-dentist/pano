import json,uuid,zipfile
from copy import deepcopy
import numpy as np
import pytest
from PIL import Image
from pano.store import Store
from pano.paths import ROOT
from pano.collaboration import *
from pano.finding_data import coverage
from pano.caries import CariesData

@pytest.fixture
def st():
    s=Store(ROOT/"tmp"/(uuid.uuid4().hex+".sqlite3"));setup(s)
    yield s
    s.close()
def film(st,split="train"):
    p=ROOT/"tmp"/(uuid.uuid4().hex+".png")
    Image.fromarray(np.random.default_rng(uuid.uuid4().int).integers(0,255,(60,100,3),dtype=np.uint8)).save(p)
    return st.add_image(p,"hanoi",split=split)
def package(st,split="train"):
    iid=film(st,split)
    aid=st.add_annotation(iid,"periapical_lesion","prediction",bbox=[10,10,30,30],geometry="lesion_box",quality="predicted",status="draft")
    made=create_package(st,"Friend",1,split=split,predict=False)
    with zipfile.ZipFile(made["path"]) as z:m=json.loads(z.read("labels.json"));assert "index.html" in z.namelist();assert z.testzip() is None
    r={"format":"pano-result","version":1,"package_id":m["package_id"],"token":m["token"],"images":deepcopy(m["images"])}
    for im in r["images"]:
        for b in im["boxes"]:b["status"]="confirmed"
        im["review"]={"caries":True,"findings":True,"hanoi":True}
    return iid,aid,m,r
def write(r):
    p=ROOT/"tmp"/(uuid.uuid4().hex+".json");p.write_text(json.dumps(r),encoding="utf-8");return p
def test_return_roundtrip_idempotence_and_training(st):
    iid,aid,m,r=package(st)
    r["images"][0]["boxes"].append({"id":"new:abcdefghijkl","category":"caries_ungraded","geometry":"lesion_box","bbox":[40,20,50,30],"status":"confirmed"})
    report=import_result(st,write(r));assert report["accepted"]==[iid]
    assert st.annotation(aid)["quality"]=="box";assert st.annotation(aid)["revision"]==2
    assert coverage(st.image(iid),st.annotations(iid),"hanoi")[0]
    data=CariesData(st);assert data.load(iid)["complete"];assert len(data.load(iid)["boxes"])==1
    assert import_result(st,write(r))["duplicate"]
    assert st.annotation(aid)["revision"]==2
    assert st.db.execute("SELECT COUNT(*) FROM human_review_events").fetchone()[0]==3
def test_assignment_blocks_user_and_double_assignment(st):
    iid,aid,m,r=package(st)
    with pytest.raises(ValueError,match="배정"):st.save(st.annotation(aid))
    with pytest.raises(ValueError,match="배정"):CariesData(st).save(CariesData(st).load(iid))
    with pytest.raises(ValueError):create_package(st,"other",1,predict=False)
    cancel(st,m["package_id"])
    st.save(st.annotation(aid))
    with pytest.raises(ValueError):import_result(st,write(r))
def test_conflict_does_not_overwrite(st):
    iid,aid,m,r=package(st)
    with permit(m["package_id"]):
        a=st.annotation(aid);a["bbox"]=[10,10,35,35];st.save(a)
    report=import_result(st,write(r));assert report["conflicts"]==[iid] and report["accepted"]==[]
    assert st.annotation(aid)["bbox"]==[10,10,35,35]
@pytest.mark.parametrize("bad",["bounds","nan","category","geometry","missing","token","pending","duplicate","outside"])
def test_untrusted_result_rejected(st,bad):
    iid,aid,m,r=package(st);im=r["images"][0];b=im["boxes"][0]
    if bad=="bounds":b["bbox"]=[-1,0,20,20]
    elif bad=="nan":b["bbox"][0]=float("nan")
    elif bad=="category":b["category"]="impacted_tooth";b["geometry"]="tooth_box"
    elif bad=="geometry":b["geometry"]="tooth_box"
    elif bad=="missing":im["boxes"]=[]
    elif bad=="token":r["token"]="wrong"
    elif bad=="pending":b["status"]="draft"
    elif bad=="duplicate":im["boxes"].append(deepcopy(b))
    elif bad=="outside":im["id"]="outside"
    with pytest.raises(ValueError):import_result(st,write(r))
    assert st.annotation(aid)["revision"]==1
def test_partial_review_not_negative_all_classes(st):
    iid,aid,m,r=package(st)
    r["images"][0]["review"]={"caries":False,"findings":False,"hanoi":True}
    import_result(st,write(r))
    assert coverage(st.image(iid),st.annotations(iid),"hanoi")[0]
    assert not coverage(st.image(iid),st.annotations(iid),"findings")[0]
    assert not CariesData(st).load(iid)["complete"]
    assert [r[0] for r in st.db.execute("SELECT scope FROM human_review_events")]==["hanoi"]
def test_test_split_stays_test(st):
    iid,aid,m,r=package(st,"test");import_result(st,write(r))
    assert st.image(iid)["split"]=="test"
def test_masks_preserved_and_locked(st):
    iid=film(st);mask=np.zeros((60,100),np.uint8);mask[10:30,20:40]=255
    aid=st.add_annotation(iid,"periapical_lesion","hanoi",mask=mask,status="confirmed",quality="precise")
    original=st.annotation(aid)["mask_path"]
    made=create_package(st,"friend",1,predict=False)
    with zipfile.ZipFile(made["path"]) as z:m=json.loads(z.read("labels.json"))
    r={"format":"pano-result","version":1,"package_id":m["package_id"],"token":m["token"],"images":deepcopy(m["images"])}
    r["images"][0]["boxes"][0]["bbox"]=[1,1,10,10]
    with pytest.raises(ValueError):import_result(st,write(r))
    assert st.annotation(aid)["mask_path"]==original
def test_patient_group_assigned_once(st):
    a,b=film(st),film(st)
    st.db.execute("UPDATE images SET group_id=? WHERE id=?",(st.image(a)["group_id"],b));st.db.commit()
    made=create_package(st,"friend",2,predict=False)
    assert made["images"]==1
    assert st.db.execute("SELECT count(*) FROM collaboration_locks").fetchone()[0]==2
def test_flagged_result_ineligible(st):
    iid,aid,m,r=package(st);r["images"][0]["needs_review"]=True
    import_result(st,write(r))
    assert not CariesData(st).load(iid)["complete"]
    assert not coverage(st.image(iid),st.annotations(iid),"hanoi")[0]
def test_merge_transaction_rollback(st):
    iid,aid,m,r=package(st)
    st.db.execute("CREATE TRIGGER fail_return BEFORE INSERT ON collaboration_returns BEGIN SELECT RAISE(ABORT,'test rollback'); END")
    st.db.commit()
    with pytest.raises(Exception):import_result(st,write(r))
    assert st.annotation(aid)["revision"]==1
    assert st.db.execute("SELECT package_id FROM collaboration_locks WHERE image_id=?",(iid,)).fetchone()[0]==m["package_id"]
