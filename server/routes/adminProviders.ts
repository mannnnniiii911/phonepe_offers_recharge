import { Router } from 'express';
import { postgresQuery } from '../postgres';
import { requireAuth, requireRole, logAudit, type AuthenticatedRequest } from '../auth';

export const adminProvidersRouter=Router();
adminProvidersRouter.use(requireAuth);

adminProvidersRouter.get('/',async (_req,res)=>{
  try {
    const r=await postgresQuery(`SELECT p.id,p.slug,p.name,p.brand_color AS "brandColor",p.badge_bg AS "badgeBg",p.text_color AS "textColor",p.tagline,p.logo_url AS "logoUrl",p.description,p.is_active AS "isActive",p.display_order AS "displayOrder",p.created_at AS "createdAt",p.updated_at AS "updatedAt",(SELECT COUNT(*)::int FROM recharge_plans WHERE provider_id=p.id) AS "planCount" FROM network_providers p ORDER BY p.display_order,p.name`);
    return res.json({success:true,providers:r.rows});
  } catch(err){console.error('[ADMIN_API_ERROR] GET /providers:',err);return res.status(500).json({error:'Failed to retrieve providers'});}
});

adminProvidersRouter.post('/',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try {
    const {name,slug,brandColor,badgeBg,textColor,tagline,logoUrl,description,isActive,displayOrder}=req.body??{};
    if(!name||!slug)return res.status(400).json({error:'Provider name and slug identifier are required.'});
    const cleanSlug=String(slug).toLowerCase().trim().replace(/[^a-z0-9_-]/g,'');
    const existing=await postgresQuery('SELECT id FROM network_providers WHERE slug=$1',[cleanSlug]);
    if(existing.rows.length)return res.status(400).json({error:`Provider with identifier '${cleanSlug}' already exists.`});
    const now=new Date().toISOString();
    await postgresQuery(`INSERT INTO network_providers (id,slug,name,brand_color,badge_bg,text_color,tagline,logo_url,description,is_active,display_order,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [cleanSlug,cleanSlug,String(name).trim(),brandColor||'#6426AD',badgeBg||'#F2EAFE',textColor||'#FFFFFF',tagline||'',logoUrl||'',description||'',isActive!==false,Number(displayOrder)||0,now,now]);
    await logAudit(req.admin,'PROVIDER_CREATE','PROVIDER',cleanSlug,`Created new telecom provider '${name}' (${cleanSlug})`,req);
    return res.json({success:true,message:'Provider added successfully',id:cleanSlug});
  }catch(err){console.error('[ADMIN_API_ERROR] POST /providers:',err);return res.status(500).json({error:'Failed to create provider'});}
});

adminProvidersRouter.put('/:id',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try{
    const {id}=req.params,{name,brandColor,badgeBg,textColor,tagline,logoUrl,description,isActive,displayOrder}=req.body??{};
    const found=await postgresQuery<{id:string;name:string}>('SELECT id,name FROM network_providers WHERE id=$1',[id]);
    if(!found.rows[0])return res.status(404).json({error:'Provider not found.'});
    if(typeof name!=='string'||!name.trim())return res.status(400).json({error:'Provider name is required.'});
    await postgresQuery(`UPDATE network_providers SET name=$1,brand_color=$2,badge_bg=$3,text_color=$4,tagline=$5,logo_url=$6,description=$7,is_active=$8,display_order=$9,updated_at=$10 WHERE id=$11`,
      [name.trim(),brandColor||'#6426AD',badgeBg||'#F2EAFE',textColor||'#FFFFFF',tagline||'',logoUrl||'',description||'',isActive!==false,Number(displayOrder)||0,new Date().toISOString(),id]);
    await logAudit(req.admin,'PROVIDER_UPDATE','PROVIDER',id,`Updated telecom provider '${name}'`,req);
    return res.json({success:true,message:'Provider updated successfully'});
  }catch(err){console.error('[ADMIN_API_ERROR] PUT /providers/:id:',err);return res.status(500).json({error:'Failed to update provider'});}
});

adminProvidersRouter.patch('/:id/toggle',requireRole(['owner','manager']),async(req:AuthenticatedRequest,res)=>{
  try{
    const found=await postgresQuery<{id:string;name:string;is_active:boolean}>('SELECT id,name,is_active FROM network_providers WHERE id=$1',[req.params.id]);
    const p=found.rows[0];if(!p)return res.status(404).json({error:'Provider not found.'});
    const active=!p.is_active,now=new Date().toISOString();
    await postgresQuery('UPDATE network_providers SET is_active=$1,updated_at=$2 WHERE id=$3',[active,now,p.id]);
    await logAudit(req.admin,active?'PROVIDER_ENABLED':'PROVIDER_DISABLED','PROVIDER',p.id,`${active?'Enabled':'Disabled'} telecom provider '${p.name}'`,req);
    return res.json({success:true,message:`Provider '${p.name}' is now ${active?'Active':'Inactive'}.`,isActive:active});
  }catch(err){console.error('[ADMIN_API_ERROR] PATCH /providers/:id/toggle:',err);return res.status(500).json({error:'Failed to toggle provider status'});}
});

adminProvidersRouter.delete('/:id',requireRole(['owner']),async(req:AuthenticatedRequest,res)=>{
  try{
    const found=await postgresQuery<{id:string;name:string}>('SELECT id,name FROM network_providers WHERE id=$1',[req.params.id]);
    const p=found.rows[0];if(!p)return res.status(404).json({error:'Provider not found.'});
    const [submissions,plans]=await Promise.all([
      postgresQuery<{c:string|number}>('SELECT COUNT(*) AS c FROM customer_submissions WHERE provider_id=$1',[p.id]),
      postgresQuery<{c:string|number}>('SELECT COUNT(*) AS c FROM recharge_plans WHERE provider_id=$1',[p.id])
    ]);
    const sc=Number(submissions.rows[0]?.c??0),pc=Number(plans.rows[0]?.c??0);
    if(sc>0)return res.status(400).json({error:`Cannot permanently delete provider '${p.name}' because it has ${sc} historical customer submission record(s). Please disable/deactivate the provider instead to preserve historical integrity.`});
    if(pc>0)return res.status(400).json({error:`Cannot permanently delete provider '${p.name}' because it has ${pc} associated recharge plan(s). Please archive or remove those plans first, or deactivate the provider.`});
    await postgresQuery('DELETE FROM network_providers WHERE id=$1',[p.id]);
    await logAudit(req.admin,'PROVIDER_DELETE','PROVIDER',p.id,`Deleted unused telecom provider '${p.name}'`,req);
    return res.json({success:true,message:`Provider '${p.name}' deleted successfully.`});
  }catch(err){console.error('[ADMIN_API_ERROR] DELETE /providers/:id:',err);return res.status(500).json({error:'Failed to delete provider'});}
});
