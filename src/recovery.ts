import type {Env} from './types';
import {getUser,rateLimit} from './accounts';
import {hashPassword,verifyPassword} from './auth';
import {checkPublicationLock} from './publication-state';
interface RecoveryUser {username:string;password_hash:string;auth_version:number;security_question:string;security_answer_hash:string}
const normalize=(answer:string)=>answer.toLowerCase().replace(/\s+/gu,'');
const failure='ユーザー名・回答を確認してください。 / Check username and answer.';
function generation(){const n=crypto.getRandomValues(new Uint32Array(2));return 2+n[0]*1048576+(n[1]&1048575);}
export async function setRecovery(env:Env,username:string,password:string,question:string,answer:string){
 await checkPublicationLock(env);
 const user=await getUser(env,username);if(!user||!await verifyPassword(password,user.password_hash))throw new Error('現在のパスワードを確認してください。 / Check your current password.');
 question=question.trim();if(!question||question.length>500||!normalize(answer)||answer.length>256)throw new Error('質問と回答を確認してください。 / Check the question and answer.');
 const hash=await hashPassword(normalize(answer));
 const result=await env.DB.prepare('UPDATE users SET security_question=?,security_answer_hash=? WHERE username=? AND password_hash=? AND auth_version=?').bind(question,hash,username,user.password_hash,user.auth_version).run();
 if(!result.meta.changes)throw new Error('Account changed; reload and retry.');
}
export async function getRecoveryQuestion(env:Env,username:string,ip:string){
 if(await rateLimit(env,'recovery:'+ip))throw new Error('しばらく待ってから再試行してください。 / Try again later.');
 const user=await env.DB.prepare('SELECT security_question FROM users WHERE username=?').bind(username).first<{security_question:string}>();
 if(!user?.security_question){await rateLimit(env,'recovery:'+ip,true);throw new Error(failure);}
 return user.security_question;
}
export async function resetPassword(env:Env,username:string,answer:string,password:string,ip:string){
 await checkPublicationLock(env);
 if(password.length<8||password.length>256||answer.length>256)throw new Error('パスワードは8〜256文字です。 / Use 8–256 characters for the password.');
 const key='recovery:'+ip;if(await rateLimit(env,key))throw new Error('しばらく待ってから再試行してください。 / Try again later.');
 const user=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first<RecoveryUser>();
 const dummy='$pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
 const valid=await verifyPassword(normalize(answer),user?.security_answer_hash||dummy);
 if(!valid||!user?.security_answer_hash){await rateLimit(env,key,true);throw new Error(failure);}
 const hash=await hashPassword(password),version=generation();
 const results=await env.DB.batch([
  env.DB.prepare('UPDATE users SET password_hash=?,auth_version=? WHERE username=? AND password_hash=? AND auth_version=? AND security_answer_hash=?').bind(hash,version,username,user.password_hash,user.auth_version,user.security_answer_hash),
  env.DB.prepare('DELETE FROM edit_locks WHERE owner=? AND EXISTS(SELECT 1 FROM users WHERE username=? AND auth_version=?)').bind(username,username,version),
  env.DB.prepare('DELETE FROM login_attempts WHERE id=? AND EXISTS(SELECT 1 FROM users WHERE username=? AND auth_version=?)').bind(key,username,version)
 ]);
 if(!results[0].meta.changes)throw new Error('Account changed; retry recovery.');
}
