"""Precompute private, unreviewed AI context; never modify source labels."""
import argparse,hashlib,json,time
from collections import Counter
from pathlib import Path
from pano.paths import ROOT
from pano.locking import gpu_operation

@gpu_operation
def prepare(manifest_path,out):
    import torch,numpy as np
    from PIL import Image
    from pano.inference import load_model,detect
    manifest=json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    out=Path(out).resolve()
    if not out.is_relative_to(ROOT.resolve()):raise ValueError('Output must stay in F:/pano')
    out.mkdir(parents=True,exist_ok=True)
    defaults=json.loads((ROOT/'models/defaults.json').read_text(encoding='utf-8'))
    model_id=defaults.get('yolo_findings') or defaults['yolo_dentex']
    torch.set_num_threads(4)
    model,meta=load_model(model_id,'cuda' if torch.cuda.is_available() else 'cpu')
    weight_hash=hashlib.file_digest((ROOT/meta['weights']).open('rb'),'sha256').hexdigest()
    if meta.get('weights_sha256') and weight_hash!=meta['weights_sha256']:raise ValueError('Weights changed')
    identity={'model_id':model_id,'weights_sha256':weight_hash,'confidence_threshold':meta.get('confidence_threshold',.25),'confidence_by_class':meta.get('confidence_by_class',{}),'nms_iou_threshold':meta.get('nms_iou_threshold',.6)}
    version=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
    rows=[];counts=Counter();started=time.monotonic()
    for n,case in enumerate(manifest['cases']):
        target=out/(case['id']+'.json')
        saved=json.loads(target.read_text(encoding='utf-8')) if target.exists() else None
        if saved and (saved['version']!=version or saved['pixel_hash']!=case['pixel_hash']):raise ValueError('Context changed; use a new output folder')
        if saved is None:
            image_path=Path(case['local_image']).resolve()
            if not image_path.is_relative_to(ROOT.resolve()):raise ValueError('Image outside F:/pano')
            image=Image.open(image_path).convert('RGB')
            if image.size!=(case['width'],case['height']):raise ValueError('Image coordinate mismatch')
            boxes=[]
            for p in detect(model,np.array(image),meta):
                if p['category'] not in ('deep_caries','impacted_tooth'):continue
                boxes.append({'id':'ai-'+str(len(boxes)+1),'category':p['category'],'geometry':'tooth_box','bbox':[float(x) for x in p['bbox']],'confidence':p['detection_score']})
            saved={'schema':'lod-ai-context-v1','case_id':case['id'],'version':version,'pixel_hash':case['pixel_hash'],'provenance':identity,'boxes':boxes,'origin':'ai_prediction','review_state':'unverified','created_at':int(time.time())}
            temp=target.with_suffix('.tmp');temp.write_text(json.dumps(saved,ensure_ascii=False),encoding='utf-8');temp.replace(target)
        rows.append(saved);counts.update(b['category'] for b in saved['boxes'])
        if (n+1)%100==0 or n==0:print(json.dumps({'done':n+1,'total':len(manifest['cases']),'seconds':round(time.monotonic()-started),'boxes':dict(counts)}),flush=True)
    quote=lambda v:"'"+str(v).replace("'","''")+"'"
    sql=[]
    for r in rows:
        value=json.dumps({k:r[k] for k in ['schema','version','provenance','boxes','origin','review_state']},ensure_ascii=False,separators=(',',':'))
        sql.append('INSERT INTO game_case_ai_context(case_id,context_json,created_at) VALUES('+','.join([quote(r['case_id']),quote(value),str(r['created_at'])])+') ON CONFLICT(case_id) DO UPDATE SET context_json=excluded.context_json,created_at=excluded.created_at;')
    (out/'context.sql').write_text('\n'.join(sql)+'\n',encoding='utf-8')
    (out/'audit.json').write_text(json.dumps({'images':len(rows),'boxes':dict(counts),'provenance':identity,'version':version,'source_labels_modified':False,'seconds':round(time.monotonic()-started)},indent=2),encoding='utf-8')
    print('AI_CONTEXT_COMPLETE '+str(out/'audit.json'),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--out',required=True);a=p.parse_args();prepare(a.manifest,a.out)
