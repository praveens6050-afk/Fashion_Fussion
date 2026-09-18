'use strict';
const ACCOUNT_KEY='ff_seller_accounts_v1';
const SESSION_KEY='ff_seller_session_v1';
const demoAccount={id:'FF-DEMO-01',firstName:'Demo',lastName:'Seller',storeName:'Demo Seller Store',email:'demo@seller.local',mobile:'9876543210',sellerType:'business',password:'seller123',createdAt:'2026-09-18T00:00:00+05:30',kycStatus:'pending'};
const $=id=>document.getElementById(id);
function accounts(){try{const rows=JSON.parse(localStorage.getItem(ACCOUNT_KEY)||'[]');return Array.isArray(rows)?rows:[]}catch{return[]}}
function saveAccounts(rows){localStorage.setItem(ACCOUNT_KEY,JSON.stringify(rows))}
function ensureDemo(){const rows=accounts();if(!rows.some(x=>String(x.email).toLowerCase()===demoAccount.email)){rows.push(demoAccount);saveAccounts(rows)}}
function setMessage(message,type=''){const box=$('authMessage');box.textContent=message;box.className='auth-message '+type}
function setMode(mode){document.querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));$('loginForm').hidden=mode!=='login';$('registerForm').hidden=mode!=='register';$('authTitle').textContent=mode==='login'?'Sign in to Seller Center':'Create your seller account';$('authSubtitle').textContent=mode==='login'?'Use the demo account or create a local seller account.':'Registration stays local until backend integration is connected.';setMessage('')}
function startSession(account,remember){const session={sellerId:account.id,email:account.email,storeName:account.storeName,name:[account.firstName,account.lastName].filter(Boolean).join(' '),createdAt:new Date().toISOString()};(remember?localStorage:sessionStorage).setItem(SESSION_KEY,JSON.stringify(session));if(remember)sessionStorage.removeItem(SESSION_KEY);else localStorage.removeItem(SESSION_KEY);location.href='index.html'}
function sessionExists(){return localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)}
function makeSellerId(rows){return'FF-SLR-'+String(rows.length+1).padStart(4,'0')}
function cleanPhone(value){return String(value||'').replace(/\D/g,'')}
ensureDemo();
if(sessionExists())location.href='index.html';
document.querySelectorAll('[data-auth-mode]').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.authMode)));
$('fillDemo').addEventListener('click',()=>{$('loginEmail').value=demoAccount.email;$('loginPassword').value=demoAccount.password;setMessage('Demo credentials filled.','ok')});
$('loginForm').addEventListener('submit',event=>{event.preventDefault();const email=$('loginEmail').value.trim().toLowerCase(),password=$('loginPassword').value;const account=accounts().find(x=>String(x.email).toLowerCase()===email&&x.password===password);if(!account){setMessage('Email or password is incorrect.','err');return}setMessage('Signed in. Opening seller dashboard…','ok');startSession(account,$('rememberMe').checked)});
$('registerForm').addEventListener('submit',event=>{event.preventDefault();const rows=accounts(),email=$('registerEmail').value.trim().toLowerCase(),mobile=cleanPhone($('mobile').value);if(rows.some(x=>String(x.email).toLowerCase()===email)){setMessage('An account with this email already exists.','err');return}if(mobile.length<10){setMessage('Enter a valid mobile number.','err');return}const account={id:makeSellerId(rows),firstName:$('firstName').value.trim(),lastName:$('lastName').value.trim(),storeName:$('storeName').value.trim(),email,mobile,sellerType:$('sellerType').value,password:$('registerPassword').value,createdAt:new Date().toISOString(),kycStatus:'pending'};rows.push(account);saveAccounts(rows);setMessage('Seller account created. Opening your dashboard…','ok');startSession(account,true)});
