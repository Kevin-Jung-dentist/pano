"""Embed exactly the published box editor; export JSON without coordinate conversion."""
from pathlib import Path
import hashlib,json
from PySide6.QtCore import QUrl,Qt
from PySide6.QtWidgets import QApplication,QDialog,QVBoxLayout,QHBoxLayout,QLabel,QPushButton,QFileDialog,QMessageBox
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineProfile,QWebEnginePage,QWebEngineSettings,QWebEngineDownloadRequest
from .paths import ROOT,inside
from .collaboration import import_result

_profiles={}
def editor_profile():
    key=str(ROOT)
    if key not in _profiles:
        profile=QWebEngineProfile("pano-shared-"+hashlib.sha256(key.encode()).hexdigest()[:12],QApplication.instance())
        storage=ROOT/"cache/common_editor/storage";cache=ROOT/"cache/common_editor/http";downloads=ROOT/"collaboration/returns"
        for p in (storage,cache,downloads):p.mkdir(parents=True,exist_ok=True)
        profile.setPersistentStoragePath(str(storage));profile.setCachePath(str(cache));profile.setDownloadPath(str(downloads))
        _profiles[key]=profile
    return _profiles[key]

class PackagePage(QWebEnginePage):
    def __init__(self,profile,view,path):
        super().__init__(profile,view);self.initial_package=inside(path);self.parent_view=view
    def chooseFiles(self,mode,oldFiles,acceptedMimeTypes):
        if any("zip" in value for value in acceptedMimeTypes):return [str(self.initial_package)]
        path,_=QFileDialog.getOpenFileName(self.parent_view,"저장한 결과 JSON",str(ROOT/"collaboration"),"Pano 결과 (*.json)")
        return [str(inside(path))] if path else []

class SharedBoxEditor(QDialog):
    def __init__(self,host,path):
        super().__init__(host);self.host=host;self.path=inside(path);self.latest_result=None;self.allow_close=False
        self.setWindowTitle("Pano 공통 박스 편집기 · PC와 웹이 같은 코드 / 원본 픽셀 JSON")
        self.resize(1440,900);self.setAttribute(Qt.WA_DeleteOnClose)
        layout=QVBoxLayout(self)
        note=QLabel("친구 웹사이트와 같은 편집기입니다. B 추가 · V 선택 · H 숨기기 · Enter 확정 · Delete 제외 · Ctrl+Z 취소\n상단 수정 결과 내보내기 후 아래 내 수정 결과 반영 · 닫기를 누르세요. 영상 좌표는 변환하거나 반올림하지 않습니다.")
        note.setWordWrap(True);layout.addWidget(note)
        self.view=QWebEngineView(self);self.profile=editor_profile();self.page=PackagePage(self.profile,self.view,self.path);self.view.setPage(self.page)
        self.page.settings().setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls,False)
        layout.addWidget(self.view,1)
        row=QHBoxLayout();self.status=QLabel("작업 ZIP을 여는 중입니다.");self.status.setWordWrap(True);row.addWidget(self.status,1)
        self.apply_button=QPushButton("내 수정 결과 반영 · 닫기");self.apply_button.setEnabled(False);self.apply_button.clicked.connect(self.apply_result);row.addWidget(self.apply_button)
        close=QPushButton("닫기 · 자동 저장본은 유지");close.clicked.connect(self.close);row.addWidget(close);layout.addLayout(row)
        self.profile.downloadRequested.connect(self.download_requested)
        self.page.loadFinished.connect(self.loaded)
        path=Path(__file__).resolve().parents[2]/"collab-web/dist/index.html"
        self.view.load(QUrl.fromLocalFile(str(path)))
    def loaded(self,ok):
        if not ok:self.status.setText("편집기 로드 실패");return
        self.status.setText("위 작업 ZIP 열기를 누르면 준비한 파일이 자동 선택됩니다: "+str(self.path))
    def download_requested(self,request):
        if request.page()!=self.page:return
        name=Path(request.downloadFileName()).name
        if not name.endswith(".pano-result.json"):request.cancel();return
        self.latest_result=None;self.apply_button.setEnabled(False)
        destination=ROOT/"collaboration/returns";destination.mkdir(parents=True,exist_ok=True)
        request.setDownloadDirectory(str(destination));request.setDownloadFileName(name)
        request.isFinishedChanged.connect(lambda:self.download_finished(request,destination/name))
        request.accept()
    def download_finished(self,request,path):
        if request.state()!=QWebEngineDownloadRequest.DownloadCompleted:
            if request.isFinished():self.status.setText("결과 저장 실패 · 내보내기를 다시 눌러주세요.")
            return
        self.latest_result=inside(path);self.apply_button.setEnabled(True);self.status.setText("결과 저장 완료 · "+str(path))
    def apply_result(self):
        if not self.latest_result:return
        self.page.runJavaScript("JSON.stringify(P.result(work))",self.apply_current_result)
    def apply_current_result(self,current_json):
        if not self.latest_result:return
        try:
            current=json.loads(current_json);saved=json.loads(self.latest_result.read_text(encoding="utf-8"))
            if any(current.get(key)!=saved.get(key) for key in ("package_id","token","images")):
                QMessageBox.warning(self,"최근 수정이 아직 내보내지지 않았습니다","수정 결과 내보내기를 다시 누른 뒤 반영하세요. 화면의 최신 수정은 유지됩니다.");return
            report=import_result(self.host.st,self.latest_result)
        except Exception as exc:QMessageBox.warning(self,"결과 반영 실패",str(exc));return
        if report["conflicts"]:
            QMessageBox.warning(self,"원본 충돌",f'반영 {len(report["accepted"])}장 / 충돌 {len(report["conflicts"])}장. 충돌 자료는 덮어쓰지 않았습니다.')
        self.host.refresh();self.host.collaboration_panel.refresh()
        self.allow_close=True;self.close()
    def closeEvent(self,event):
        if self.allow_close:
            try:self.profile.downloadRequested.disconnect(self.download_requested)
            except RuntimeError:pass
            event.accept();return
        event.ignore()
        def checked(dirty):
            if dirty and QMessageBox.question(self,"아직 결과를 내보내지 않았습니다","같은 ZIP을 다시 열면 이 PC의 자동 저장본으로 이어갈 수 있습니다. 결과를 내보내지 않고 닫을까요?")!=QMessageBox.Yes:return
            self.allow_close=True;self.close()
        self.page.runJavaScript("Boolean(exportDirty)",checked)
