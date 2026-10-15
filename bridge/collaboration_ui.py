"""Desktop entry point for ZIP-based collaboration."""
from PySide6.QtWidgets import *
from PySide6.QtCore import Qt,QUrl
from PySide6.QtGui import QDesktopServices
from .paths import ROOT
from .store import Store
from .io import read_json,write_json
from .collaboration import create_package,import_result,list_packages,cancel

class CollaborationPanel(QWidget):
    def __init__(self,window):
        super().__init__();self.window=window;layout=QVBoxLayout(self)
        title=QLabel("친구에게 ZIP 하나로 작업을 전달하세요");title.setObjectName("title");layout.addWidget(title)
        guide=QLabel("① 담당자와 영상 분량 선택 → ② AI 초안 포함 ZIP 생성 → ③ 친구가 웹에서 박스 교정 → ④ 결과 JSON 가져오기\n배정된 원본·중복 영상은 다른 작업에서 잠깁니다. 반환 결과는 버전 충돌을 검사하며, train/val/test는 유지됩니다.")
        guide.setWordWrap(True);layout.addWidget(guide)
        form=QFormLayout();self.actor=QLineEdit();self.actor.setPlaceholderText("예: 민수")
        self.count=QSpinBox();self.count.setRange(1,200);self.count.setValue(50)
        self.source=QComboBox();self.source.addItems([r[0] for r in window.st.db.execute("SELECT DISTINCT source FROM images ORDER BY source")]);self.source.setCurrentText("hanoi")
        self.split=QComboBox();self.split.addItems(["train","val","test"])
        self.url=QLineEdit(read_json(ROOT/"config/collaboration.json",{}).get("editor_url",""));self.url.setPlaceholderText("https://프로젝트.pages.dev 또는 https://프로젝트.vercel.app")
        self.predict=QCheckBox("현재 활성 모델로 네 가지 병소의 AI 초안 생성");self.predict.setChecked(True)
        for name,w in (("친구 이름",self.actor),("분량",self.count),("데이터",self.source),("분할",self.split),("웹 주소 (없어도 ZIP 안에 편집기 포함)",self.url)):form.addRow(name,w)
        form.addRow(self.predict);layout.addLayout(form)
        row=QHBoxLayout()
        self.make=QPushButton("친구 작업 ZIP 만들기");self.make.setObjectName("primary");self.make.clicked.connect(self.create);row.addWidget(self.make)
        imp=QPushButton("친구 수정 결과 JSON 가져오기");imp.clicked.connect(self.receive);row.addWidget(imp)
        folder=QPushButton("전달할 ZIP 폴더 열기");folder.clicked.connect(lambda:QDesktopServices.openUrl(QUrl.fromLocalFile(str(ROOT/"collaboration/outbox"))));row.addWidget(folder);layout.addLayout(row)
        self.info=QPlainTextEdit();self.info.setReadOnly(True);self.info.setMaximumHeight(155);layout.addWidget(self.info)
        self.packages=QListWidget();layout.addWidget(self.packages)
        controls=QHBoxLayout();refresh=QPushButton("배정 목록 새로고침");refresh.clicked.connect(self.refresh);controls.addWidget(refresh)
        revoke=QPushButton("선택 배정 취소 · 본인 작업으로 회수");revoke.clicked.connect(self.revoke);controls.addWidget(revoke);layout.addLayout(controls)
        self.refresh()
    def refresh(self):
        self.packages.clear()
        for p in list_packages(self.window.st):
            label={"preparing":"생성 중","exported":"전달 / 반환 대기","completed":"반환 완료","cancelled":"취소","failed":"생성 실패"}.get(p["state"],p["state"])
            item=QListWidgetItem(f'{p["actor"]} · {label} · {p["created"]} · {p["id"][:10]}');item.setData(Qt.UserRole,p["id"]);self.packages.addItem(item)
    def create(self):
        actor=self.actor.text().strip();count=self.count.value();source=self.source.currentText();split=self.split.currentText();url=self.url.text().strip();predict=self.predict.isChecked()
        if not actor:QMessageBox.information(self,"담당자","친구 이름을 입력하세요.");return
        if url and not url.startswith("https://"):QMessageBox.information(self,"주소","https://로 시작하는 배포 주소를 입력하세요.");return
        write_json(ROOT/"config/collaboration.json",{"editor_url":url});self.make.setEnabled(False)
        self.info.setPlainText("배정 및 AI 초안을 준비합니다. 영상 수에 따라 시간이 걸립니다. 실패 시 배정은 자동 해제됩니다.")
        def work():
            st=Store()
            try:return create_package(st,actor,count,source,split,predict,url)
            finally:st.close()
        # Re-enable on either completion path, without changing the host's task runner.
        from .app import Task
        from PySide6.QtCore import QThreadPool
        task=Task(work);self.window.tasks.append(task)
        task.signals.done.connect(lambda r:self.finished(task,r))
        task.signals.error.connect(lambda error:self.failed(task,error))
        QThreadPool.globalInstance().start(task)
    def finished(self,task,result):
        if task in self.window.tasks:self.window.tasks.remove(task)
        self.make.setEnabled(True);self.info.setPlainText(f'준비 완료 · {result["images"]}장 / {result["size_mb"]}MB\n{result["path"]}\n이 ZIP 하나를 친구에게 보내세요. 압축 해제 후 index.html을 열어도 됩니다.')
        self.refresh();self.window.refresh()
    def failed(self,task,error):
        if task in self.window.tasks:self.window.tasks.remove(task)
        self.make.setEnabled(True);self.info.setPlainText(error[-2500:]);self.refresh()
    def receive(self):
        path,_=QFileDialog.getOpenFileName(self,"친구 수정 결과",str(ROOT/"collaboration"),"Pano 결과 (*.json)")
        if not path:return
        def work():
            st=Store()
            try:return import_result(st,path)
            finally:st.close()
        def done(report):
            self.info.setPlainText(f'반영 {len(report["accepted"])}장 · 충돌 {len(report["conflicts"])}장 · 변경 없음 {len(report["unchanged"])}장\n'+
                                  ("이미 가져온 동일 결과입니다.\n" if report.get("duplicate") else "")+
                                  ("충돌 영상은 덮어쓰지 않았습니다: "+", ".join(report["conflicts"]) if report["conflicts"] else "검토 완료된 train 자료는 다음 새 학습에 반영됩니다. 학습은 자동 시작하지 않습니다."))
            self.refresh()
        self.window.async_task(work,done=done)
    def revoke(self):
        item=self.packages.currentItem()
        if not item:return
        if QMessageBox.question(self,"배정 회수","배정을 취소하면 해당 ZIP의 나중 반환 결과는 가져올 수 없습니다. 먼저 필요한 결과를 받았는지 확인하세요. 회수할까요?")!=QMessageBox.Yes:return
        cancel(self.window.st,item.data(Qt.UserRole));self.refresh();self.window.refresh()
