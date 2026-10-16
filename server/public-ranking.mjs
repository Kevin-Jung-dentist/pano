const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export const PUBLIC_RANK_LIMIT=250;
export function publicNickname(value){
 const chars=[...graphemes.segment(String(value??'').normalize('NFC'))].map(x=>x.segment);
 if(chars.length>4)return chars.slice(0,2).join('')+'***'+chars.slice(-2).join('');
 // Do not reveal the whole name when the two ends overlap.
 if(chars.length>2)return chars[0]+'***'+chars.at(-1);
 if(chars.length===2)return chars[0]+'***';
 return '***';
}
export function publicEntries(rows,mode){
 return mode==='individual'?rows.map(row=>({...row,name:publicNickname(row.name)})):rows;
}
