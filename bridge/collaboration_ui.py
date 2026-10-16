"""Assignment progress, partial handoff and identical local/web box editing."""
from PySide6.QtWidgets import *
from PySide6.QtCore import Qt,QUrl,QThreadPool
from PySide6.QtGui import QDesktopServices
from .paths import ROOT
from .store import Store
from .io import read_json,write_json
from .collaboration import create_package,import_result,list_packages,cancel,package_progress,reclaim_unfinished,package_path
import json

class CollaborationPanel(QWidget):
    def __init__(self,window):
        super().__init__();self.window=window;self.editors=[];layout=QVBoxLayout(self)
        title=QLabel("친구와 분담하고, 같은 편집기로 작업하세요");title.setObjectName("title");layout.addWidget(title)
        guide=QLabel("친구에게 배정된 영상은 수정 잠김으로 표시됩니다. 결과 JSON을 받으면 완료·부분 작업·미반환 수를 확인할 수 있습니다.\n미완료 회수는 이미 받은 수정본을 보존합니다. 친구 PC에만 남은 변경은 먼저 JSON으로 받아주세요. 진행률은 반환 파일 기준입니다.")
        guide.setWordWrap(True);layout.addWidget(guide)
        form=QFormLayout();self.actor=QLineEdit();self.actor.setPlaceholderText("친구 이름")
        self.count=QSpinBox();self.count.setRange(1,200);self.count.setValue(100)
        self.source=QComboBox();self.source.addItems([r[0] for r in window.st.db.execute("SELECT DISTINCT source FROM images ORDER BY source")]);self.source.setCurrentText("hanoi")
        self.split=QComboBox();self.split.addItems(["train","val","test"])
        self.url=QLineEdit(read_json(ROOT/"config/collaboration.json",{}).get("editor_url","https://pano-9kh.pages.dev/editor/"))
        self.predict=QCheckBox("활성 모델로 네 가지 병소의 AI 초안 생성");self.predict.setChecked(True)
        for name,w in (("친구 이름",self.actor),("분량",self.count),("데이터",self.source),("분할",self.split),("웹 주소",self.url)):form.addRow(name,w)
        form.addRow(self.predict);layout.addLayout(form)
        row=QHBoxLayout()
        self.make=QPushButton("친구 작업 ZIP 만들기");self.make.setObjectName("primary");self.make.clicked.connect(self.create);row.addWidget(self.make)
        self.my_work=QPushButton("본인 작업 준비 · 같은 편집기");self.my_work.clicked.connect(lambda:self.prepare_self());row.addWidget(self.my_work)
        imp=QPushButton("친구 수정 결과 JSON 가져오기");imp.clicked.connect(self.receive);row.addWidget(imp)
        folder=QPushButton("전달할 ZIP 폴더");folder.clicked.connect(lambda:QDesktopServices.openUrl(QUrl.fromLocalFile(str(ROOT/"collaboration/outbox"))));row.addWidget(folder);layout.addLayout(row)
        self.info=QPlainTextEdit();self.info.setReadOnly(True);self.info.setMaximumHeight(145);layout.addWidget(self.info)
        self.packages=QListWidget();self.packages.currentItemChanged.connect(self.selected_details);layout.addWidget(self.packages)
        row=QHBoxLayout()
        for text,fn in (("목록 새로고침",self.refresh),("내 작업 이어 열기",self.open_selected),("미완료 회수 · 내 작업으로",self.reclaim),("회수분 같은 편집기로 이어하기",self.continue_reclaimed),("전체 배정 취소",self.revoke)):
            b=QPushButton(text);b.clicked.connect(fn);row.addWidget(b)
        layout.addLayout(row);self.refresh()
    def selected_pid(self):
        item=self.packages.currentItem()
        return item.data(Qt.UserRole) if item else None
    def refresh(self):
        selected=self.selected_pid();self.packages.blockSignals(True);self.packages.clear()
        for p in list_packages(self.window.st):
            progress=package_progress(self.window.st,p["id"])
            state={"preparing":"생성 중","exported":"반환 대기","returned":"반환됨 · 미완료 있음","completed":"전체 완료","reclaimed":"미완료 회수됨","cancelled":"취소","failed":"생성 실패"}.get(p["state"],p["state"])
            item=QListWidgetItem(f'{p["actor"]} · {state} · {p["created"]}\n총 {progress["total"]}장 | 완료 {progress["complete"]} · 부분 {progress["partial"]} · 미반환 {progress["waiting"]} · 회수 {progress["reclaimed"]}')
            item.setData(Qt.UserRole,p["id"]);self.packages.addItem(item)
            if p["id"]==selected:self.packages.setCurrentItem(item)
        self.packages.blockSignals(False)
    def selected_details(self,*args):
        pid=self.selected_pid()
        if not pid:return
        p=package_progress(self.window.st,pid)
        path=package_path(self.window.st,pid)
        self.info.setPlainText(f'ZIP: {path}\n완료 {p["complete"]}장 / 부분 작업 {p["partial"]}장 / 미반환 {p["waiting"]}장 / 회수 {p["reclaimed"]}장\n' +
            "\n".join(d["name"]+" · "+{"complete":"완료","partial":"반환 · 미완료","waiting":"친구/본인 편집기 작업 중","reclaimed":"본인 회수"}[d["state"]] for d in p["details"][:12]))
    def start_package(self,actor,owner_kind="friend",image_ids=None,predict=None):
        count=len(image_ids) if image_ids is not None else self.count.value()
        source=self.source.currentText();split=self.split.currentText();url=self.url.text().strip()
        if not actor:QMessageBox.information(self,"담당자","친구 이름을 입력하세요.");return
        if url and not url.startswith("https://"):QMessageBox.information(self,"주소","https://로 시작하는 주소를 입력하세요.");return
        predict=self.predict.isChecked() if predict is None else predict
        write_json(ROOT/"config/collaboration.json",{"editor_url":url});self.make.setEnabled(False);self.my_work.setEnabled(False)
        self.info.setPlainText("중복 배정을 제외하고 작업을 준비합니다. 기존 수정·확정은 보존합니다.")
        def work():
            st=Store()
            try:return create_package(st,actor,count,source,split,predict,url,image_ids,owner_kind)
            finally:st.close()
        from .app import Task
        task=Task(work);self.window.tasks.append(task)
        task.signals.done.connect(lambda r:self.finished(task,r,owner_kind=="self"))
        task.signals.error.connect(lambda error:self.failed(task,error));QThreadPool.globalInstance().start(task)
    def create(self):self.start_package(self.actor.text().strip())
    def prepare_self(self,image_ids=None):
        if not self.window.require_saved() or not self.window.caries_panel.require_saved():return
        self.start_package("본인 · 공통 편집기","self",image_ids)
    def finished(self,task,result,open_editor=False):
        if task in self.window.tasks:self.window.tasks.remove(task)
        self.make.setEnabled(True);self.my_work.setEnabled(True)
        self.info.setPlainText(f'준비 완료 · {result["images"]}장 / {result["size_mb"]}MB\n{result["path"]}\n친구에게는 ZIP 하나를 전달하세요. 본인 자료는 같은 편집기에서 작업합니다.')
        self.refresh();self.window.refresh()
        if open_editor:self.show_editor(result["path"])
    def failed(self,task,error):
        if task in self.window.tasks:self.window.tasks.remove(task)
        self.make.setEnabled(True);self.my_work.setEnabled(True);self.info.setPlainText(error[-2500:]);self.refresh()
    def show_editor(self,path):
        from .shared_editor import SharedBoxEditor
        editor=SharedBoxEditor(self.window,path);self.editors.append(editor);editor.show()
    def open_selected(self):
        pid=self.selected_pid()
        if not pid:return
        row=self.window.st.db.execute("SELECT record,state FROM collaboration_packages WHERE id=?",(pid,)).fetchone()
        record=json.loads(row[0])
        if record.get("owner_kind")!="self":
            QMessageBox.information(self,"친구 작업 보호","친구 작업은 먼저 결과 JSON을 가져온 뒤 미완료 회수 버튼으로 가져오세요.");return
        if row[1]!="exported":
            QMessageBox.information(self,"새 작업 버전","이미 반영한 작업입니다. 미완료 회수 후 회수분 이어하기로 새 버전을 여세요.");return
        self.show_editor(package_path(self.window.st,pid))
    def receive(self):
        path,_=QFileDialog.getOpenFileName(self,"친구 수정 결과",str(ROOT/"collaboration"),"Pano 결과 (*.json)")
        if not path:return
        def work():
            st=Store()
            try:return import_result(st,path)
            finally:st.close()
        def done(report):
            self.info.setPlainText(f'반영 {len(report["accepted"])}장 · 충돌/회수된 영상 {len(report["conflicts"])}장 · 변경 없음 {len(report["unchanged"])}장\n미완료 회수로 나머지를 이어할 수 있습니다. 이미 받은 수정본은 보존됩니다.')
            self.refresh()
        self.window.async_task(work,done=done)
    def reclaim(self):
        pid=self.selected_pid()
        if not pid:return
        p=package_progress(self.window.st,pid);n=p["partial"]+p["waiting"]
        if not n:QMessageBox.information(self,"회수","새로 회수할 미완료 영상이 없습니다.");return
        if QMessageBox.question(self,"미완료 회수",f"{n}장을 본인 작업으로 회수할까요?\n친구가 수정한 내용은 먼저 결과 JSON으로 받아주세요. 이미 가져온 수정은 유지합니다.\n회수한 영상의 이전 친구 ZIP에서 나중에 오는 수정은 자동 덮어쓰지 않습니다.")!=QMessageBox.Yes:return
        try:result=reclaim_unfinished(self.window.st,pid)
        except Exception as exc:QMessageBox.warning(self,"회수 실패",str(exc));return
        self.info.setPlainText(f'{len(result["reclaimed"])}장 회수 완료. 회수분 같은 편집기로 이어하기를 누르세요. 다른 배정과 겹친 {len(result["skipped"])}장은 유지했습니다.')
        self.refresh();self.window.refresh()
    def continue_reclaimed(self):
        pid=self.selected_pid()
        if not pid:return
        p=package_progress(self.window.st,pid)
        ids=[d["id"] for d in p["details"] if d["state"]=="reclaimed" and not self.window.st.image(d["id"]).get("assignment")]
        if not ids:QMessageBox.information(self,"이어하기","먼저 미완료 회수 버튼을 누르세요. 이미 다른 작업에 배정된 영상은 제외합니다.");return
        self.start_package("본인 · 회수 이어하기","self",ids,False)
    def revoke(self):
        pid=self.selected_pid()
        if not pid:return
        if QMessageBox.question(self,"전체 배정 취소","이 ZIP의 이후 반환을 모두 중단합니다. 일부만 이어하려면 미완료 회수를 사용하세요. 전체 배정을 취소할까요?")!=QMessageBox.Yes:return
        cancel(self.window.st,pid);self.refresh();self.window.refresh()
