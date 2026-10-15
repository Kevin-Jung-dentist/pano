"""Offscreen integration test of the actual Qt-embedded HTML editor."""
import json,time,uuid,subprocess
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from PIL import Image
from PySide6.QtCore import Qt,QEventLoop,QTimer,QPoint
from PySide6.QtWidgets import QApplication,QWidget
from PySide6.QtTest import QTest
from pano.paths import ROOT
from pano.store import Store
from pano.collaboration import create_package,import_result
from pano.shared_editor import SharedBoxEditor

def js(page,script):
    loop=QEventLoop();result=[]
    page.runJavaScript(script,lambda value:(result.append(value),loop.quit()))
    QTimer.singleShot(10000,loop.quit);loop.exec()
    assert result,"JS evaluation timed out"
    return result[0]

def wait_for(fn,seconds=15):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if fn():return
        QTest.qWait(50)
    raise AssertionError("Editor did not reach expected state")

def test_same_javascript_export_in_qt_and_node(monkeypatch):
    app=QApplication.instance() or QApplication([])
    st=Store();path=ROOT/"tmp"/"shared_editor_synthetic.png"
    Image.fromarray(np.random.default_rng(49182).integers(0,255,(180,320,3),dtype=np.uint8)).save(path)
    iid=st.add_image(path,"hanoi",split="train")
    aid=st.add_annotation(iid,"periapical_lesion","prediction",bbox=[10.125,10.75,29.625,31.875],geometry="lesion_box",quality="predicted",status="draft")
    made=create_package(st,"same actor",1,predict=False,owner_kind="self")
    host=QWidget();host.st=st;host.refresh=lambda:None;host.collaboration_panel=SimpleNamespace(refresh=lambda:None)
    editor=SharedBoxEditor(host,made["path"]);editor.show()
    try:
        wait_for(lambda:js(editor.page,"document.readyState==='complete' && Boolean(document.getElementById('open'))"))
        def click(selector):
            rect=json.loads(js(editor.page,"JSON.stringify((()=>{const r=document.querySelector("+json.dumps(selector)+").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())"))
            QTest.mouseClick(editor.view.focusProxy(),Qt.LeftButton,Qt.NoModifier,QPoint(round(rect['x']),round(rect['y'])))
        click('#open')
        try:wait_for(lambda:js(editor.page,"typeof work !== 'undefined' && work !== null"))
        except AssertionError:
            print('EDITOR_DEBUG',js(editor.page,"JSON.stringify({url:location.href,state:document.readyState,core:typeof Pano,zip:typeof PanoZip,body:document.body.innerText,files:document.getElementById('file')?.files.length})"))
            raise
        js(editor.page,"document.querySelector('#boxes button').click(); document.getElementById('confirm').click(); document.getElementById('finish').click();")
        wait_for(lambda:bool(js(editor.page,"work.images[0].review.hanoi")))
        desktop=json.loads(js(editor.page,"JSON.stringify(P.result(work))"))
        work=js(editor.page,"JSON.stringify(work)")
        core=str(Path(__file__).resolve().parents[1]/"collab-web/dist/core.js")
        command="const P=require(process.argv[1]);let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(P.result(JSON.parse(s)))));"
        browser_code=json.loads(subprocess.run(["node","-e",command,core],input=work,text=True,capture_output=True,check=True).stdout)
        desktop.pop("exported_at");browser_code.pop("exported_at")
        assert desktop==browser_code
        assert desktop["images"][0]["boxes"][0]["bbox"]==[10.125,10.75,29.625,31.875]
        click("#export")
        wait_for(lambda:editor.latest_result is not None)
        out=json.loads(editor.latest_result.read_text(encoding="utf-8"))
        assert out["images"]==desktop["images"]
        warnings=[]
        from PySide6.QtWidgets import QMessageBox
        monkeypatch.setattr(QMessageBox,"warning",lambda *args:warnings.append(args))
        stale=json.loads(json.dumps(out));stale["images"][0]["boxes"][0]["bbox"][0]=11.125
        editor.apply_current_result(json.dumps(stale))
        assert warnings and st.annotation(aid)["status"]=="draft"
        report=import_result(st,editor.latest_result)
        assert report["accepted"]==[iid]
        assert st.annotation(aid)["bbox"]==[10.125,10.75,29.625,31.875]
        assert editor.profile.persistentStoragePath().replace("\\","/").startswith(str(ROOT).replace("\\","/"))
        editor.grab().save(str(ROOT/"shared_editor_verified.png"))
    finally:
        editor.allow_close=True;editor.close();app.processEvents();host.close();st.close()
