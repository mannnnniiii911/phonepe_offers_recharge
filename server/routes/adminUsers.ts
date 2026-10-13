import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { postgresQuery } from '../postgres';
import { requireAuth, requireRole, logAudit, type AuthenticatedRequest } from '../auth';
import crypto from 'crypto';

export const adminUsersRouter = Router();
adminUsersRouter.use(requireAuth);

adminUsersRouter.get('/', requireRole(['owner']), async (_req,res) => {
  try {
    const result=await postgresQuery('SELECT id,username,email,role,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM admin_users ORDER BY created_at ASC');
    return res.json({success:true,users:result.rows});
  } catch(err) { console.error('[ADMIN_API_ERROR] GET /users:',err); return res.status(500).json({error:'Failed to retrieve admin users'}); }
});

adminUsersRouter.post('/', requireRole(['owner']), async (req:AuthenticatedRequest,res) => {
  try {
    const {username,email,password,role='viewer'}=req.body??{};
    if(!username||!email||!password) return res.status(400).json({error:'Username, email, and password are required.'});
    if(String(password).length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
    if(!['owner','manager','viewer'].includes(role)) return res.status(400).json({error:'Invalid administrator role.'});
    const cleanUsername=String(username).trim().toLowerCase(), cleanEmail=String(email).trim().toLowerCase();
    const existing=await postgresQuery('SELECT id FROM admin_users WHERE username=$1 OR email=$2',[cleanUsername,cleanEmail]);
    if(existing.rows.length) return res.status(400).json({error:'A user with this username or email already exists.'});
    const passwordHash=await bcrypt.hash(String(password),12), id='admin-'+crypto.randomUUID().slice(0,8), now=new Date().toISOString();
    await postgresQuery("INSERT INTO admin_users (id,username,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'active',$6,$7)",[id,cleanUsername,cleanEmail,passwordHash,role,now,now]);
    await logAudit(req.admin,'ADMIN_USER_CREATE','ADMIN_USER',id,`Created new administrator '${cleanUsername}' with role '${role}'`,req);
    return res.json({success:true,message:'Administrator created successfully',id});
  } catch(err) { console.error('[ADMIN_API_ERROR] POST /users:',err); return res.status(500).json({error:'Failed to create administrator'}); }
});

adminUsersRouter.put('/:id/role', requireRole(['owner']), async (req:AuthenticatedRequest,res) => {
  try {
    const {id}=req.params, {role,status}=req.body??{};
    if(role!==undefined&&!['owner','manager','viewer'].includes(role)) return res.status(400).json({error:'Invalid role.'});
    if(status!==undefined&&!['active','inactive'].includes(status)) return res.status(400).json({error:'Invalid status.'});
    const found=await postgresQuery<{id:string;username:string;role:string}>('SELECT id,username,role FROM admin_users WHERE id=$1',[id]);
    const user=found.rows[0];
    if(!user) return res.status(404).json({error:'User not found.'});
    if(user.role==='owner'&&(role!=='owner'||status==='inactive')) {
      const count=await postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM admin_users WHERE role='owner' AND status='active'");
      if(Number(count.rows[0]?.c??0)<=1) return res.status(400).json({error:'Cannot downgrade or deactivate the only active Owner account.'});
    }
    await postgresQuery('UPDATE admin_users SET role=COALESCE($1,role),status=COALESCE($2,status),updated_at=$3 WHERE id=$4',[role||null,status||null,new Date().toISOString(),id]);
    await logAudit(req.admin,'ADMIN_USER_UPDATE','ADMIN_USER',id,`Updated role/status for admin '${user.username}'`,req);
    return res.json({success:true,message:'Administrator updated successfully.'});
  } catch(err) { console.error('[ADMIN_API_ERROR] PUT /users/:id/role:',err); return res.status(500).json({error:'Failed to update administrator'}); }
});

adminUsersRouter.delete('/:id', requireRole(['owner']), async (req:AuthenticatedRequest,res) => {
  try {
    const {id}=req.params;
    if(id===req.admin?.id) return res.status(400).json({error:'You cannot delete your own account.'});
    const found=await postgresQuery<{id:string;username:string;role:string}>('SELECT id,username,role FROM admin_users WHERE id=$1',[id]);
    const user=found.rows[0];
    if(!user) return res.status(404).json({error:'User not found.'});
    if(user.role==='owner') {
      const count=await postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM admin_users WHERE role='owner'");
      if(Number(count.rows[0]?.c??0)<=1) return res.status(400).json({error:'Cannot delete the only Owner account.'});
    }
    await postgresQuery('DELETE FROM admin_users WHERE id=$1',[id]);
    await logAudit(req.admin,'ADMIN_USER_DELETE','ADMIN_USER',id,`Deleted administrator '${user.username}'`,req);
    return res.json({success:true,message:'Administrator deleted.'});
  } catch(err) { console.error('[ADMIN_API_ERROR] DELETE /users/:id:',err); return res.status(500).json({error:'Failed to delete administrator'}); }
});
