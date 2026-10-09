import {cleanReport} from './validate.ts';
const encoder=new TextEncoder();
const hex=(a:ArrayBuffer)=>Array.from(new Uint8Array(a),n=>n.toString(16).padStart(2,'0')).join('');
const hash=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function rpc(name:string,args:unknown):Promise<Record<string,unknown>> {
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${name}`,{
 method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
 if(!response.ok) throw new Error('database');
 return await response.json();
}
async function body(req:Request):Promise<Record<string,unknown>|null>{
 if(!req.body)return null;
 const reader=req.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try { while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>32768){await reader.cancel();return null;}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const value=JSON.parse(new TextDecoder().decode(bytes));return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 } catch{return null;}finally{reader.releaseLock();}
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json(405,{ok:false});
 const b=await body(req);if(!b)return json(400,{ok:false});
 try{
 if(b.action==='enrol'){
  // Tidsbegraenset automatisk tilmelding. Token returneres kun ved oprettelse.
  // Der er intet faelles adgangstoken eller service-key i APK'en.
  const token=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const result=await rpc('ns_diagnostic_enrol',{p_token_hash:await hash(token)});
  if(result.status==='ok')return json(200,{ok:true,token,supportCode:result.supportCode,expiresAt:result.expiresAt});
  return json(result.status==='limited'?429:410,{ok:false});
 }
 // Egen capability-autentifikation; verify_jwt=false er noedvendigt.
 const token=req.headers.get('x-diagnostic-token')??'';
 if(!/^[a-f0-9]{64}$/.test(token))return json(401,{ok:false});
 if(b.action==='stop'){
  const result=await rpc('ns_diagnostic_stop',{p_token_hash:await hash(token)});
  return json(result.status==='ok'?200:403,{ok:result.status==='ok'});
 }
 if(b.action!=='upload'||typeof b.reportId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.reportId))return json(400,{ok:false});
 const report=cleanReport(b.report);if(!report)return json(400,{ok:false});
 const result=await rpc('ns_diagnostic_upload',{p_token_hash:await hash(token),p_report_id:b.reportId,p_payload:report});
 const status=result.status==='ok'?200:result.status==='limited'?429:result.status==='expired'?410:403;
 return json(status,{ok:status===200});
 }catch{return json(503,{ok:false});}
});
