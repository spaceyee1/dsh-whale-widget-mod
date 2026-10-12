function loopback(value){return value==='::1'||value==='localhost'||/^127(?:\.(?:\d{1,3})){3}$/.test(value)&&value.split('.').every(n=>Number(n)<=255)||/^::ffff:127(?:\.(?:\d{1,3})){3}$/i.test(value)}
export function companionRejection(req){
  try{
    const h=req.headers||{},host=String(h.host||''),peer=req.socket?.remoteAddress||''
    if(!loopback(peer)||!host||/[\s/@\\?#]/.test(host))return 403
    const local=new URL((req.socket?.encrypted?'https:':'http:')+'//'+host)
    if(!loopback(local.hostname.replace(/^\[|\]$/g,'')))return 403
    if(Object.keys(h).some(k=>k.toLowerCase()==='forwarded'||k.toLowerCase().startsWith('x-forwarded-')||k.toLowerCase()==='x-real-ip'))return 403
    if(h.origin!==undefined&&h.origin!==local.origin)return 403
    if(h['sec-fetch-site']&&!['same-origin','none'].includes(h['sec-fetch-site']))return 403
    if(h['x-dshw-companion']!=='1')return 403
    if(['POST','PUT','PATCH'].includes(req.method)&&!/^application\/json(?:\s*;|$)/i.test(h['content-type']||''))return 415
    return null
  }catch{return 403}
}
