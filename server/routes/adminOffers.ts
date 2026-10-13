import { Router } from 'express';
import crypto from 'crypto';
import { postgresQuery } from '../postgres';
import { requireAuth, requireRole, logAudit, type AuthenticatedRequest } from '../auth';

export const adminOffersRouter=Router();
adminOffersRouter.use(requireAuth);

adminOffersRouter.get('/',async(_req,res)=>{
  try{
    const r=await postgresQuery(`SELECT o.id,o.title,o.message,o.subtitle,o.banner_url AS "bannerUrl",o.provider_id AS "providerId",prov.name AS "providerName",o.timer_mode AS "timerMode",o.start_time AS "startTime",o.end_time AS "endTime",o.duration_minutes AS "durationMinutes",o.status,o.display_order AS "displayOrder",o.created_at AS "createdAt",o.updated_at AS "updatedAt" FROM special_offers o LEFT JOIN network_providers prov ON o.provider_id=prov.id ORDER BY o.display_order,o.created_at DESC`);
    return res.json({success:true,offers:r.rows});
  }catch(err){console.error('[ADMIN_API_ERROR] GET /offers:',err);return res.status(500).json({error:'Failed to retrieve offers'});}
});

adminOffersRouter.post('/',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try{
    const {title,message,subtitle,bannerUrl,providerId,timerMode='duration',durationMinutes=30,startTime,endTime,status='active',displayOrder}=req.body??{};
    if(!title||!message)return res.status(400).json({error:'Title and message are required.'});
    const now=new Date(), start=startTime?new Date(startTime):now;
    if(Number.isNaN(start.getTime()))return res.status(400).json({error:'Invalid start time.'});
    let end:Date;
    if(timerMode==='duration')end=new Date(start.getTime()+Number(durationMinutes||30)*60000);
    else {if(!endTime)return res.status(400).json({error:'End time is required for fixed deadline mode.'});end=new Date(endTime);}
    if(Number.isNaN(end.getTime())||end<=start)return res.status(400).json({error:'Offer end time must be after its start time.'});
    const id='offer-'+crypto.randomUUID().slice(0,8),nowIso=now.toISOString();
    await postgresQuery(`INSERT INTO special_offers (id,title,message,subtitle,banner_url,provider_id,timer_mode,start_time,end_time,duration_minutes,status,display_order,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id,String(title).trim(),String(message).trim(),subtitle?.trim()||'',bannerUrl||'',providerId||null,timerMode,start.toISOString(),end.toISOString(),Number(durationMinutes)||30,status,Number(displayOrder)||0,nowIso,nowIso]);
    await logAudit(req.admin,'OFFER_CREATE','OFFER',id,`Created special offer '${title}' (Mode: ${timerMode}, End: ${end.toISOString()})`,req);
    return res.json({success:true,message:'Special offer created successfully',id});
  }catch(err){console.error('[ADMIN_API_ERROR] POST /offers:',err);return res.status(500).json({error:'Failed to create offer'});}
});

adminOffersRouter.put('/:id',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try{
    const {id}=req.params,{title,message,subtitle,bannerUrl,providerId,timerMode='duration',durationMinutes=30,startTime,endTime,status='active',displayOrder}=req.body??{};
    if(!title||!message)return res.status(400).json({error:'Title and message are required.'});
    const existing=await postgresQuery<{id:string}>('SELECT id FROM special_offers WHERE id=$1',[id]);
    if(!existing.rows[0])return res.status(404).json({error:'Offer not found.'});
    const now=new Date(),start=startTime?new Date(startTime):now;
    if(Number.isNaN(start.getTime()))return res.status(400).json({error:'Invalid start time.'});
    const end=timerMode==='duration'?new Date(start.getTime()+Number(durationMinutes||30)*60000):(endTime?new Date(endTime):new Date(now.getTime()+1800000));
    if(Number.isNaN(end.getTime())||end<=start)return res.status(400).json({error:'Offer end time must be after its start time.'});
    await postgresQuery(`UPDATE special_offers SET title=$1,message=$2,subtitle=$3,banner_url=$4,provider_id=$5,timer_mode=$6,start_time=$7,end_time=$8,duration_minutes=$9,status=$10,display_order=$11,updated_at=$12 WHERE id=$13`,
      [String(title).trim(),String(message).trim(),subtitle?.trim()||'',bannerUrl||'',providerId||null,timerMode,start.toISOString(),end.toISOString(),Number(durationMinutes)||30,status,Number(displayOrder)||0,now.toISOString(),id]);
    await logAudit(req.admin,'OFFER_UPDATE','OFFER',id,`Updated special offer '${title}'`,req);
    return res.json({success:true,message:'Offer updated successfully'});
  }catch(err){console.error('[ADMIN_API_ERROR] PUT /offers/:id:',err);return res.status(500).json({error:'Failed to update offer'});}
});

adminOffersRouter.patch('/:id/status',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try{
    const {status}=req.body??{};
    if(!['active','paused','expired'].includes(status))return res.status(400).json({error:'Invalid offer status.'});
    const found=await postgresQuery<{id:string;title:string}>('SELECT id,title FROM special_offers WHERE id=$1',[req.params.id]);
    const offer=found.rows[0];if(!offer)return res.status(404).json({error:'Offer not found.'});
    await postgresQuery('UPDATE special_offers SET status=$1,updated_at=$2 WHERE id=$3',[status,new Date().toISOString(),offer.id]);
    await logAudit(req.admin,'OFFER_STATUS_CHANGE','OFFER',offer.id,`Changed offer '${offer.title}' status to '${status}'`,req);
    return res.json({success:true,message:`Offer status changed to '${status}'.`});
  }catch(err){console.error('[ADMIN_API_ERROR] PATCH /offers/:id/status:',err);return res.status(500).json({error:'Failed to update offer status'});}
});

adminOffersRouter.delete('/:id',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try{
    const found=await postgresQuery<{id:string;title:string}>('SELECT id,title FROM special_offers WHERE id=$1',[req.params.id]);
    const offer=found.rows[0];if(!offer)return res.status(404).json({error:'Offer not found.'});
    await postgresQuery('DELETE FROM special_offers WHERE id=$1',[offer.id]);
    await logAudit(req.admin,'OFFER_DELETE','OFFER',offer.id,`Deleted offer '${offer.title}'`,req);
    return res.json({success:true,message:'Offer deleted successfully.'});
  }catch(err){console.error('[ADMIN_API_ERROR] DELETE /offers/:id:',err);return res.status(500).json({error:'Failed to delete offer'});}
});
