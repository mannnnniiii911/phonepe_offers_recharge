import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { postgresPool, postgresQuery } from '../postgres';
import { requireAuth, requireRole, logAudit, type AuthenticatedRequest } from '../auth';
import { getPersistentPaymentSettings, isSupabasePaymentSettingsConfigured, savePersistentPaymentSettings, uploadPaymentQr } from '../supabasePaymentSettings';

export const adminSettingsRouter=Router();
adminSettingsRouter.use(requireAuth);
adminSettingsRouter.get('/',async(_req,res)=>{
  try{
    const result=await postgresQuery<{setting_key:string;setting_value:string;updated_at:string;updated_by:string}>('SELECT setting_key,setting_value,updated_at,updated_by FROM website_settings');
    const settings:Record<string,string>={};for(const r of result.rows)settings[r.setting_key]=r.setting_value;
    if(isSupabasePaymentSettingsConfigured())Object.assign(settings,await getPersistentPaymentSettings());
    return res.json({success:true,settings});
  }catch(err){console.error('[ADMIN_API_ERROR] GET /settings:',err);return res.status(500).json({error:'Failed to retrieve settings'});}
});
function isValidUpiId(id:string):boolean{return /^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z0-9.\-_]{2,50}$/.test(id.trim());}
const ALLOWED_IMAGE_MIMES=['image/jpeg','image/png','image/webp'];
const MAX_BASE64_BYTES=5*1024*1024;

adminSettingsRouter.put('/',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try{
    const updates=req.body;
    if(!updates||typeof updates!=='object'||Array.isArray(updates))return res.status(400).json({error:'Invalid settings payload.'});
    if('upi_id' in updates){const upi=String(updates.upi_id||'').trim();if(!upi)return res.status(400).json({error:'UPI ID cannot be empty.'});if(!isValidUpiId(upi))return res.status(400).json({error:'Invalid UPI ID format. Expected format: username@bank (e.g. user@ybl).'});updates.upi_id=upi;}
    if('qr_code_url' in updates){
      const qrVal=String(updates.qr_code_url||'').trim();if(!qrVal)return res.status(400).json({error:'QR Code image cannot be empty.'});
      if(qrVal.startsWith('data:')){
        const match=qrVal.match(/^data:([^;]+);base64,/);if(!match)return res.status(400).json({error:'Invalid image data URI format.'});
        const mime=match[1].toLowerCase(),normalized=mime==='image/jpg'?'image/jpeg':mime;
        if(!ALLOWED_IMAGE_MIMES.includes(normalized))return res.status(400).json({error:'Unsupported image format. Please upload JPEG, PNG, or WebP.'});
        const buffer=Buffer.from(qrVal.replace(/^data:[^;]+;base64,/,''),'base64');
        if(buffer.length>MAX_BASE64_BYTES)return res.status(400).json({error:'Image file size exceeds the maximum limit of 5MB.'});
        try{fs.writeFileSync(path.join(process.cwd(),'public','assets','upi-qr.jpg'),buffer);}catch(err){console.warn('[ADMIN_SETTINGS] Could not sync local QR image:',err);}
      }
    }
    const adminUser=req.admin?.username||'admin';
    if(isSupabasePaymentSettingsConfigured()&&typeof updates.qr_code_url==='string'&&updates.qr_code_url.startsWith('data:'))updates.qr_code_url=await uploadPaymentQr(updates.qr_code_url);
    const paymentUpdates:Record<string,string>={};
    for(const key of ['upi_id','qr_code_url'])if(key in updates&&typeof updates[key]==='string')paymentUpdates[key]=updates[key];
    if(isSupabasePaymentSettingsConfigured()&&Object.keys(paymentUpdates).length)await savePersistentPaymentSettings(paymentUpdates,adminUser);

    const client=await postgresPool.connect();
    try{
      await client.query('BEGIN');
      const now=new Date().toISOString();
      for(const [key,value] of Object.entries(updates)){
        if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'){
          await client.query(`INSERT INTO website_settings(setting_key,setting_value,updated_at,updated_by) VALUES($1,$2,$3,$4)
            ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by`,
            [key,String(value),now,adminUser]);
        }
      }
      await client.query('COMMIT');
    }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
    await logAudit(req.admin,'SETTINGS_UPDATE','WEBSITE_SETTINGS','ALL','Updated website settings and promotional parameters',req);
    return res.json({success:true,message:'Settings updated successfully.'});
  }catch(err){
    console.error('[ADMIN_API_ERROR] PUT /settings:',err);
    const detail=err instanceof Error?err.message.slice(0,300):'Unknown server error';
    return res.status(500).json({error:`Failed to update settings: ${detail}`});
  }
});
