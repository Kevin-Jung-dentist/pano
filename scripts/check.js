const fs=require('node:fs'),vm=require('node:vm');
// Keep the legacy game URL and offline/desktop editor assets in sync.
fs.copyFileSync('dist/index.html','dist/play/index.html');
for(const f of ['app.js','core.js','zip.js','style.css'])fs.copyFileSync('dist/'+f,'dist/editor/'+f);
for(const f of ['editor/index.html','index.html','app.js','core.js','zip.js','style.css','game-core.js','play/index.html','play/play.css','play/landing.css','play/assets/banner-before.png','play/assets/banner-after.png','play/play.js','play/landing.js','play/example.js','play/canvas.js','play/i18n.js','play/locales/ko.js','play/locales/en.js','play/locales/ja.js','play/terms.html','play/terms.js','play/setup.html','play/practice.svg'])if(!fs.statSync('dist/'+f).size)throw Error(f);
for(const f of ['app.js','core.js','zip.js','game-core.js','play/play.js','play/landing.js','play/example.js','play/canvas.js','play/i18n.js','play/locales/ko.js','play/locales/en.js','play/locales/ja.js','play/terms.js'])new vm.Script(fs.readFileSync('dist/'+f,'utf8'),{filename:f});
if(fs.existsSync('dist/_worker.js'))throw Error('Unexpected bundled worker in source dist');
console.log('Pano ZIP editor and League assets verified');