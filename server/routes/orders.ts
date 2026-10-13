import { Router } from 'express';
import crypto from 'crypto';
import { postgresQuery } from '../postgres';

export const ordersRouter = Router();
function maskMobile(num:string):string { return num.length < 4 ? '****' : num.slice(0,2)+'******'+num.slice(-2); }
function hashMobile(num:string):string { return crypto.createHash('sha256').update(num).digest('hex'); }

ordersRouter.post('/orders', async (req,res) => {
  try {
    const {mobileNumber,providerId,providerName,planId,planPrice,planSnapshot,paymentMethod,upiId,orderRef} = req.body ?? {};
    if (!mobileNumber || !providerId || !providerName || planPrice === undefined || !upiId || !orderRef) return res.status(400).json({error:'Missing required order fields.'});
    const cleaned = String(mobileNumber).replace(/\D/g,'');
    const digits = cleaned.length===12 && cleaned.startsWith('91') ? cleaned.slice(2) : cleaned;
    if (!/^[6-9]\d{9}$/.test(digits)) return res.status(400).json({error:'Invalid mobile number format.'});
    const numPrice = Number(planPrice);
    if (!Number.isFinite(numPrice) || numPrice<=0 || numPrice>100000) return res.status(400).json({error:'Invalid plan price.'});
    const existing = await postgresQuery<{id:string;payment_started_at:string|null;created_at:string}>('SELECT id,payment_started_at,created_at FROM recharge_orders WHERE order_ref = $1',[String(orderRef)]);
    if (existing.rows[0]) {
      const order=existing.rows[0], windowSecs=paymentMethod==='qr'?300:210;
      return res.status(200).json({success:true,orderId:order.id,orderRef,status:'pending_verification',paymentStartedAt:order.payment_started_at||order.created_at,paymentWindowSeconds:windowSecs,message:'Order already exists. Timer continues from original start time.'});
    }
    const id='order-'+crypto.randomUUID(), now=new Date().toISOString();
    const forwarded=req.headers['x-forwarded-for'];
    const clientIp=(Array.isArray(forwarded)?forwarded[0]:forwarded?.split(',')[0])||req.socket?.remoteAddress||'';
    await postgresQuery(`
      INSERT INTO recharge_orders (id,order_ref,mobile_number_hash,masked_mobile,provider_id,provider_name,plan_id,plan_price,plan_snapshot,payment_method,upi_id,payment_status,payment_started_at,client_ip,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'pending_verification',$12,$13,$14,$15)
    `,[id,String(orderRef),hashMobile(digits),maskMobile(digits),providerId,providerName,planId||null,numPrice,JSON.stringify(planSnapshot||{}),paymentMethod||'upi',upiId,now,clientIp,now,now]);
    return res.status(201).json({success:true,orderId:id,orderRef,status:'pending_verification',paymentStartedAt:now,paymentWindowSeconds:paymentMethod==='qr'?300:210,message:'Order created for manual verification.'});
  } catch(err) { console.error('[API_ERROR] POST /orders:',err); return res.status(500).json({error:'Failed to create order.'}); }
});

ordersRouter.post('/orders/:orderRef/confirm', (_req,res) => res.status(403).json({error:'Customer self-confirmation is disabled. Payments must be verified manually by an authorized administrator.'}));

ordersRouter.get('/orders/:orderRef/status', async (req,res) => {
  try {
    const result=await postgresQuery<{order_ref:string;masked_mobile:string;provider_name:string;plan_price:number;payment_method:string;payment_status:string;payment_started_at:string|null;created_at:string}>(
      'SELECT order_ref,masked_mobile,provider_name,plan_price,payment_method,payment_status,payment_started_at,created_at FROM recharge_orders WHERE order_ref = $1',[req.params.orderRef]);
    const order=result.rows[0];
    if (!order) return res.status(404).json({error:'Order not found.'});
    return res.json({success:true,order:{orderRef:order.order_ref,maskedMobile:order.masked_mobile,providerName:order.provider_name,amount:order.plan_price,paymentMethod:order.payment_method,status:order.payment_status,paymentStartedAt:order.payment_started_at||order.created_at,paymentWindowSeconds:120,createdAt:order.created_at}});
  } catch(err) { console.error('[API_ERROR] GET /orders/:orderRef/status:',err); return res.status(500).json({error:'Failed to retrieve order status.'}); }
});
