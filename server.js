const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const dbFile = process.env.DB_PATH || path.join(process.cwd(), 'data', 'lottery.sqlite');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec(`CREATE TABLE IF NOT EXISTS gifts(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,qty INTEGER NOT NULL DEFAULT 1,image TEXT,emoji TEXT DEFAULT '🎁');
CREATE TABLE IF NOT EXISTS draws(id INTEGER PRIMARY KEY AUTOINCREMENT,gift_id INTEGER,gift_name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);`);
if (db.prepare('SELECT COUNT(*) AS n FROM gifts').get().n === 0) {
  const add = db.prepare('INSERT INTO gifts(name,qty,emoji) VALUES(?,?,?)');
  add.run('复古拍立得',1,'📷'); add.run('周末野餐篮',1,'🧺'); add.run('一点好心情',1,'🌼');
}
const json = (res, code, data) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>6*1024*1024)reject(Error('请求内容过大'))});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch{reject(Error('请求格式错误'))}});req.on('error',reject)})}
function isAdmin(req){const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return false;const hash=crypto.createHash('sha256').update(token).digest('hex');const row=db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(hash);if(!row)return false;if(row.expires_at<Date.now()){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);return false}return true}
function needAdmin(req,res){if(!ADMIN_PASSWORD){json(res,503,{error:'管理密码尚未配置，请联系站点管理员'});return false}if(!isAdmin(req)){json(res,401,{error:'管理身份已失效，请重新登录'});return false}return true}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{
 if(url.pathname==='/api/gifts'&&req.method==='GET')return json(res,200,{gifts:db.prepare('SELECT id,name,qty,image,emoji FROM gifts WHERE qty>0 ORDER BY id').all()});
 if(url.pathname==='/api/draw'&&req.method==='POST'){db.exec('BEGIN IMMEDIATE');try{const gift=db.prepare('SELECT id,name,qty,image,emoji FROM gifts WHERE qty>0 ORDER BY id').all();if(!gift.length){db.exec('ROLLBACK');return json(res,409,{error:'礼物已经抽完啦'})}const selected=gift[crypto.randomInt(gift.length)];const changed=db.prepare('UPDATE gifts SET qty=qty-1 WHERE id=? AND qty>0').run(selected.id);if(!changed.changes)throw Error('请再试一次');db.prepare('INSERT INTO draws(gift_id,gift_name) VALUES(?,?)').run(selected.id,selected.name);db.exec('COMMIT');return json(res,200,{gift:{name:selected.name,image:selected.image,emoji:selected.emoji}})}catch(e){try{db.exec('ROLLBACK')}catch{}throw e}}
 if(url.pathname==='/api/admin/login'&&req.method==='POST'){const {password=''}=await body(req);if(!ADMIN_PASSWORD)return json(res,503,{error:'管理密码尚未配置，请联系站点管理员'});if(!crypto.timingSafeEqual(Buffer.from(String(password)),Buffer.from(ADMIN_PASSWORD)))return json(res,401,{error:'密码不正确'});const token=crypto.randomBytes(32).toString('base64url');const hash=crypto.createHash('sha256').update(token).digest('hex');db.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)').run(hash,Date.now()+TOKEN_TTL_MS);return json(res,200,{token})}
 if(url.pathname==='/api/admin/draws'&&req.method==='GET'){if(!needAdmin(req,res))return;return json(res,200,{draws:db.prepare('SELECT id,gift_name AS giftName,created_at AS createdAt FROM draws ORDER BY id DESC LIMIT 200').all()})}
 if(url.pathname==='/api/admin/gifts'&&req.method==='PUT'){if(!needAdmin(req,res))return;const {gifts=[]}=await body(req);if(!Array.isArray(gifts)||gifts.length>100)return json(res,400,{error:'礼物数据无效'});for(const g of gifts){if(!String(g.name||'').trim()||String(g.name).length>100)return json(res,400,{error:'每件礼物都需要有效名称'});if(!Number.isInteger(Number(g.qty))||Number(g.qty)<0||Number(g.qty)>10000)return json(res,400,{error:'库存必须是 0 到 10000 的整数'});if(g.image&&(!String(g.image).startsWith('data:image/')||String(g.image).length>3_000_000))return json(res,400,{error:'图片格式无效或太大，请使用 2MB 以内图片'})}
 db.exec('BEGIN IMMEDIATE');try{db.exec('DELETE FROM gifts');const ins=db.prepare('INSERT INTO gifts(name,qty,image,emoji) VALUES(?,?,?,?)');for(const g of gifts)ins.run(String(g.name).trim(),Number(g.qty),g.image||null,g.emoji||'🎁');db.exec('COMMIT')}catch(e){try{db.exec('ROLLBACK')}catch{}throw e}return json(res,200,{ok:true})}
 if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
 const file=path.join(process.cwd(),'index.html');if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/admin')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(file).pipe(res)}
 res.writeHead(404);res.end('Not found');
 }catch(e){console.error(e);json(res,500,{error:'服务器暂时无法处理请求'})}});
server.listen(PORT,'0.0.0.0',()=>console.log(`Gift lottery listening on ${PORT}`));

