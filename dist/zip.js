/* Read only our ZIP_STORED work packages, lazily. No extraction to disk. */
(function(root){
"use strict";
const table=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
async function open(file){
 if(file.size>1_500_000_000)throw Error("작업 ZIP을 1.5GB 이하로 나눠주세요.");
 const tail=new DataView(await file.slice(Math.max(0,file.size-65557)).arrayBuffer());let p=-1;
 for(let i=tail.byteLength-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50){p=i;break;}
 if(p<0)throw Error("완성된 ZIP 파일이 아닙니다.");
 const count=tail.getUint16(p+10,true),size=tail.getUint32(p+12,true),offset=tail.getUint32(p+16,true);
 if(count>500||size>200000||offset+size>file.size||tail.getUint16(p+4,true)||tail.getUint16(p+6,true))throw Error("지원하지 않는 ZIP 형식");
 const dir=new DataView(await file.slice(offset,offset+size).arrayBuffer()),entries=new Map();let i=0;
 for(let n=0;n<count;n++){
  if(i+46>dir.byteLength||dir.getUint32(i,true)!==0x02014b50)throw Error("ZIP 목록 손상");
  const nl=dir.getUint16(i+28,true),el=dir.getUint16(i+30,true),cl=dir.getUint16(i+32,true);
  const name=new TextDecoder().decode(new Uint8Array(dir.buffer,i+46,nl));
  if(entries.has(name)||name.includes("..")||name.startsWith("/")||name.includes("\\")||dir.getUint16(i+8,true)&1)throw Error("ZIP 경로 또는 암호화 오류");
  const e={name,method:dir.getUint16(i+10,true),crc:dir.getUint32(i+16,true),size:dir.getUint32(i+24,true),packed:dir.getUint32(i+20,true),offset:dir.getUint32(i+42,true)};
  if(e.method!==0||e.size!==e.packed||e.size>80_000_000||e.offset+e.size>offset)throw Error("Pano에서 생성한 무압축 작업 ZIP을 사용하세요.");
  entries.set(name,e);i+=46+nl+el+cl;
 }
 async function bytes(name){
  const e=entries.get(name);if(!e)throw Error("ZIP에서 파일을 찾을 수 없습니다: "+name);
  const head=new DataView(await file.slice(e.offset,e.offset+30).arrayBuffer());
  if(head.getUint32(0,true)!==0x04034b50)throw Error("ZIP 파일 헤더 손상");
  const start=e.offset+30+head.getUint16(26,true)+head.getUint16(28,true);
  if(start+e.size>offset)throw Error("ZIP 파일 범위 오류");
  const data=new Uint8Array(await file.slice(start,start+e.size).arrayBuffer());
  if(crc32(data)!==e.crc)throw Error("ZIP 파일 무결성 검사 실패: "+name);
  return data;
 }
 return {entries,bytes,json:async name=>{const e=entries.get(name);if(!e||e.size>15_000_000)throw Error("라벨 파일 크기 오류");return JSON.parse(new TextDecoder().decode(await bytes(name)));}};
}
const api={open,crc32};if(typeof module!=="undefined")module.exports=api;else root.PanoZip=api;
})(globalThis);
