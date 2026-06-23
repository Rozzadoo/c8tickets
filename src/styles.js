const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@300;400;500;600;700&display=swap');
:root{--bg:#0c0a07;--bg2:#161310;--bg3:#211c14;--bg4:#2f271c;--text:#f0e9da;--text2:#b5a78a;--text3:#7a6c54;--gold:#c8922a;--gold-l:#e5a83a;--gold-d:#8b6914;--red:#b33a2a;--green:#5d8a3c;--r:10px;--rs:6px;--border:rgba(200,146,42,.12)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Barlow',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;max-width:100vw}
.app{min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden}
main{flex:1;width:100%;min-width:0;overflow-x:hidden}
.dsp{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:1.5px;font-weight:700}

.skip-link{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}.skip-link:focus{position:fixed;top:0;left:0;width:auto;height:auto;padding:10px 16px;background:var(--gold);color:var(--bg);font-weight:700;z-index:9999;text-decoration:none;border-radius:0 0 6px 0}
.nav{display:flex;align-items:center;justify-content:flex-start;gap:16px;padding:10px 20px;padding-top:calc(10px + env(safe-area-inset-top));background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);overflow:hidden}
.nav-logo{cursor:pointer;display:flex;align-items:center;gap:10px;flex-shrink:0}
.nav-logo img{height:64px;opacity:.95}
.nav-links{display:flex;gap:4px;overflow-x:auto;flex-shrink:1;min-width:0;-webkit-overflow-scrolling:touch;margin-left:auto}
.nav-links::-webkit-scrollbar{display:none}
@media(max-width:600px){.nav{padding:6px 12px;padding-top:calc(6px + env(safe-area-inset-top))}.nav-logo img{height:50px}.nav-links{gap:2px}.nav-links .btn{padding:5px 9px;font-size:11px;letter-spacing:0}}
.btn{background:none;border:1px solid transparent;color:var(--text2);padding:7px 14px;border-radius:99px;cursor:pointer;font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;transition:all .2s;text-transform:uppercase;letter-spacing:.5px}
.btn:hover,.btn.on{background:var(--bg3);color:var(--text);border-color:var(--border)}
.btn.gold{background:linear-gradient(135deg,var(--gold),var(--gold-d));color:var(--bg);border-color:var(--gold)}
.btn.gold:hover{filter:brightness(1.15)}

.hero{padding:16px 20px 16px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(200,146,42,.2) 0%,transparent 60%),radial-gradient(ellipse at 50% 120%,rgba(200,146,42,.07) 0%,transparent 55%);pointer-events:none}
.hero::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--gold-d),transparent)}
.hero-logo{width:clamp(280px,80vw,560px);height:auto;opacity:.97;margin-bottom:12px}
.hero p{color:var(--text2);font-size:clamp(13px,1.8vw,16px);font-weight:400;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:14px}
.hero-cta{display:inline-flex;align-items:center;gap:8px;padding:12px 32px;border:1px solid rgba(200,146,42,.5);border-radius:99px;color:var(--gold);font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:pointer;background:rgba(200,146,42,.06);transition:all .25s;margin-bottom:14px}
.hero-cta:hover{background:rgba(200,146,42,.14);border-color:var(--gold)}
.hero-sub{display:flex;justify-content:center;gap:16px;font-size:11px;color:var(--text3);flex-wrap:wrap}

.sec{padding:20px;max-width:1200px;margin:0 auto;width:100%;position:relative;z-index:1}
.sec-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.sec-title{font-size:24px}
.filters{display:flex;gap:5px;flex-wrap:wrap}
.chip{padding:5px 12px;border-radius:99px;border:1px solid var(--bg4);background:transparent;color:var(--text2);cursor:pointer;font-size:11px;font-family:'Barlow',sans-serif;font-weight:600;transition:all .2s;text-transform:uppercase;letter-spacing:.5px}
.chip.on,.chip:hover{background:var(--gold);color:var(--bg);border-color:var(--gold)}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;cursor:pointer;transition:all .3s}
.card:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(200,146,42,.1);border-color:rgba(200,146,42,.25)}
.card-img{height:190px;display:flex;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,var(--bg3),var(--bg4));position:relative}
.card-cat{position:absolute;top:10px;right:10px;background:rgba(12,10,7,.8);backdrop-filter:blur(6px);padding:3px 10px;border-radius:99px;font-size:9px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:1.5px;border:1px solid rgba(200,146,42,.2)}
.sold-out-badge{position:absolute;inset:0;background:rgba(12,10,7,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(1px);font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:22px;letter-spacing:5px;text-transform:uppercase;color:#f0e9da;border:none}
.card-body{padding:16px}
.card-date{font-size:11px;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
.card-title{font-size:20px;margin-bottom:4px;line-height:1.2}
.card-desc{color:var(--text2);font-size:12px;line-height:1.5;margin-bottom:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;justify-content:space-between;align-items:center}
.card-price{font-weight:700;font-size:17px}
.card-price small{font-weight:400;font-size:11px;color:var(--text3)}

.feat{border-radius:var(--r);overflow:hidden;cursor:pointer;margin-bottom:28px;border:1px solid rgba(200,146,42,.2);transition:border-color .3s,box-shadow .3s}
.feat:hover{box-shadow:0 16px 48px rgba(200,146,42,.18);border-color:rgba(200,146,42,.4)}
.feat-bg{height:400px;background:linear-gradient(135deg,var(--bg3),var(--bg4));background-size:cover;background-position:center;position:relative;display:flex;align-items:flex-end}
.feat-grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(12,10,7,1) 0%,rgba(12,10,7,.7) 40%,rgba(12,10,7,.05) 100%)}
.feat-body{position:relative;z-index:1;padding:28px 32px;width:100%}
.feat-eyebrow{display:inline-flex;align-items:center;gap:8px;background:rgba(200,146,42,.15);border:1px solid rgba(200,146,42,.35);color:var(--gold);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;padding:4px 12px;border-radius:99px;margin-bottom:14px}
.feat-title{font-family:'Barlow Condensed',sans-serif;font-size:clamp(28px,5vw,48px);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text);line-height:1.05;margin-bottom:8px}
.feat-date{font-size:12px;color:var(--gold);font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:18px}
.feat-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.feat-price{font-size:20px;font-weight:700;color:var(--text)}
@media(max-width:600px){.feat-bg{height:300px}.feat-body{padding:20px 22px}}

.back{display:inline-flex;align-items:center;gap:5px;color:var(--text2);cursor:pointer;font-size:13px;margin-bottom:20px;padding:6px 0;transition:color .2s;text-transform:uppercase;letter-spacing:1px;font-weight:600}
.back:hover{color:var(--gold)}
.d-hero{display:flex;align-items:center;justify-content:center;font-size:72px;height:180px;background:linear-gradient(135deg,var(--bg3),var(--bg4));border-radius:var(--r);margin-bottom:24px;border:1px solid var(--border)}
.d-meta{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;font-size:13px;color:var(--text2)}
.d-meta strong{color:var(--text)}
.d-desc{color:var(--text2);line-height:1.7;font-size:14px;margin-bottom:28px;max-width:700px}
.directions-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:var(--rs);font-size:12px;font-weight:600;color:var(--text2);border:1px solid var(--border);text-decoration:none;margin-bottom:16px;transition:color .2s,border-color .2s}
.directions-btn:hover{color:var(--gold);border-color:var(--gold)}
.share-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.share-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;cursor:pointer;text-decoration:none;border:none;transition:opacity .2s,transform .1s;flex-shrink:0}
.share-btn:hover{opacity:.85;transform:translateY(-1px)}
.share-fb{background:#1877f2;color:#fff}
.share-tw{background:#000;color:#fff;border:1px solid #333}
.share-ig{background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);color:#fff}
.share-sms{background:#5d8a3c;color:#fff}
.share-native{background:#c8922a;color:#fff}

.tkt-sec{background:var(--bg2);border-radius:var(--r);padding:24px;border:1px solid var(--border)}
.tkt-sec h3{font-size:20px;margin-bottom:16px}
.tkt-row{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid rgba(200,146,42,.08);flex-wrap:wrap;gap:10px}
.tkt-row:last-of-type{border-bottom:none}
.tkt-info h4{font-size:14px;font-weight:600;margin-bottom:1px}
.tkt-info p{font-size:11px;color:var(--text3)}
.tkt-price{font-size:17px;font-weight:700;color:var(--gold);min-width:65px;text-align:right}
.qty{display:flex;align-items:center}
.qb{width:34px;height:34px;border:1px solid var(--bg4);background:var(--bg3);color:var(--text);border-radius:var(--rs);cursor:pointer;font-size:17px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.qb:hover{background:var(--gold);border-color:var(--gold);color:var(--bg)}
.qb:disabled{opacity:.3;cursor:not-allowed}.qb:disabled:hover{background:var(--bg3);border-color:var(--bg4);color:var(--text)}
.qv{width:40px;text-align:center;font-weight:700;font-size:15px}
.cart-sum{margin-top:20px;padding-top:16px;border-top:2px solid var(--bg4)}
.cart-ln{display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:6px}
.cart-tot{display:flex;justify-content:space-between;font-size:20px;font-weight:700;margin-top:10px;padding-top:10px;border-top:1px solid var(--bg4)}
.buy{width:100%;margin-top:16px;padding:14px;background:linear-gradient(135deg,var(--gold),var(--gold-d));color:var(--bg);border:none;border-radius:var(--rs);font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:2px;text-transform:uppercase}
.buy:hover{filter:brightness(1.15);transform:translateY(-1px)}
.buy:disabled{opacity:.4;cursor:not-allowed;transform:none;filter:none}

.fg{margin-bottom:14px}
.fl{display:block;font-size:10px;font-weight:700;color:var(--text3);margin-bottom:5px;text-transform:uppercase;letter-spacing:1.5px}
.fi{width:100%;padding:11px 14px;background:var(--bg3);border:1px solid var(--bg4);border-radius:var(--rs);color:var(--text);font-family:'Barlow',sans-serif;font-size:13px;transition:border-color .2s;outline:none}
.fi:focus{border-color:var(--gold)}
.fr{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.tkt-disp{background:var(--bg2);border-radius:var(--r);padding:28px;text-align:center;border:1px solid var(--border);max-width:400px;margin:0 auto;position:relative;overflow:hidden}
.tkt-disp::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--gold-d),var(--gold),var(--gold-d))}
.tkt-disp .qr{background:white;border-radius:10px;padding:14px;display:inline-block;margin:16px 0}
.tkt-disp .cid{font-family:monospace;font-size:11px;color:var(--text3);margin-top:6px;letter-spacing:1.5px}
.tkt-items{text-align:left;background:var(--bg3);border-radius:var(--rs);padding:14px;margin:14px 0}
.tkt-items li{display:flex;justify-content:space-between;padding:3px 0;font-size:13px;list-style:none;color:var(--text2)}
.badge{display:inline-block;padding:3px 12px;border-radius:99px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px}
.badge-ok{background:rgba(93,138,60,.2);color:var(--green);border:1px solid rgba(93,138,60,.3)}
.badge-done{background:rgba(255,255,255,.05);color:var(--text3);border:1px solid rgba(255,255,255,.08)}
.badge-sold{background:rgba(179,58,42,.15);color:var(--red);border:1px solid rgba(179,58,42,.3)}
.badge-cancelled{background:rgba(255,255,255,.04);color:var(--text3);border:1px solid rgba(255,255,255,.08);text-decoration:line-through}
.badge-warn{background:rgba(200,146,42,.15);color:var(--gold);border:1px solid rgba(200,146,42,.3)}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(200,146,42,.15);color:var(--gold)}

.admin{display:grid;grid-template-columns:200px 1fr;min-height:calc(100vh - 61px)}
@media(max-width:768px){.admin{grid-template-columns:1fr;align-content:start}}
.aside{background:var(--bg2);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;gap:3px}
@media(max-width:768px){.aside{flex-direction:row;flex-wrap:nowrap;overflow-x:auto;padding:8px 10px;border-right:none;border-bottom:1px solid var(--border);scrollbar-width:none;gap:2px}.aside::-webkit-scrollbar{display:none}.aside-btn{padding:8px 10px;justify-content:center}.aside-btn span.aside-label{display:none}}
@media(max-width:480px){.aside-btn{padding:8px 6px}}
.aside-btn{padding:9px 14px;border-radius:var(--rs);border:none;background:transparent;color:var(--text2);cursor:pointer;font-family:'Barlow',sans-serif;font-size:13px;text-align:left;transition:all .15s;white-space:nowrap;font-weight:500}
.aside-btn:hover,.aside-btn.on{background:var(--bg3);color:var(--gold)}
.amain{padding:28px;overflow-y:auto;overflow-x:hidden;max-width:100%}
@media(max-width:768px){.amain{padding:14px}}

.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:28px}
.sc{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:18px}
.sc .l{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700}
.sc .v{font-size:28px;font-weight:700}
.sc .v.gd{color:var(--gold)}
.sc .s{font-size:11px;color:var(--text3);margin-top:3px}

.dt{width:100%;border-collapse:collapse}
.dt th{text-align:left;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;padding:10px 14px;border-bottom:1px solid var(--bg4);font-weight:700}
.dt td{padding:12px 14px;border-bottom:1px solid rgba(200,146,42,.05);font-size:13px}
.dt tr:hover td{background:rgba(200,146,42,.03)}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;padding:14px}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:28px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto}
.modal h2{font-size:22px;margin-bottom:20px}

.empty{text-align:center;padding:50px 20px;color:var(--text3)}
.empty .ic{font-size:40px;margin-bottom:12px}
.ci-btn{padding:5px 12px;border-radius:var(--rs);border:1px solid var(--green);background:transparent;color:var(--green);cursor:pointer;font-size:11px;font-weight:700;font-family:'Barlow',sans-serif;transition:all .15s;text-transform:uppercase;letter-spacing:.5px}
.ci-btn:hover{background:var(--green);color:var(--bg)}
.ci-btn.dn{border-color:var(--text3);color:var(--text3);cursor:default;opacity:.5}
.fade{animation:fi .35s ease}
@keyframes fi{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.footer{background:var(--bg2);border-top:1px solid var(--border);padding:28px 20px;text-align:center;margin-top:auto}
.footer-links{display:flex;justify-content:center;gap:20px;flex-wrap:wrap;margin-bottom:12px}
.footer-links a{color:var(--text3);font-size:12px;text-decoration:none;transition:color .2s}
.footer-links a:hover{color:var(--gold)}
.footer-copy{font-size:11px;color:var(--text3)}
.about-hero{text-align:center;padding:16px 20px 16px;border-bottom:1px solid var(--border)}
.about-hero h1{font-size:clamp(36px,7vw,64px);color:var(--gold);margin-bottom:12px;line-height:1}
.about-hero p{font-size:clamp(15px,2.5vw,19px);color:var(--text2);max-width:580px;margin:0 auto;line-height:1.7}
.about-sec{max-width:820px;margin:0 auto;padding:56px 20px}
.about-sec h2{font-size:clamp(24px,4vw,36px);color:var(--text);margin-bottom:16px}
.about-sec p{color:var(--text2);font-size:15px;line-height:1.8;margin-bottom:14px}
.about-divider{width:48px;height:3px;background:linear-gradient(90deg,var(--gold-d),var(--gold));border-radius:2px;margin:0 auto 48px}
.about-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:8px}
.about-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:24px;transition:border-color .2s}
.about-card:hover{border-color:rgba(200,146,42,.35)}
.about-card-icon{font-size:28px;margin-bottom:12px}
.about-card h3{font-size:15px;color:var(--text);margin-bottom:8px;text-transform:uppercase;letter-spacing:1.5px;font-family:'Barlow Condensed',sans-serif;font-weight:700}
.about-card p{color:var(--text2);font-size:13px;line-height:1.7;margin:0}
.about-cta{text-align:center;padding:56px 20px 72px;border-top:1px solid var(--border)}
.about-cta h2{font-size:clamp(24px,4vw,36px);color:var(--text);margin-bottom:12px}
.about-cta p{color:var(--text2);font-size:15px;margin-bottom:28px}
.about-cta a{color:var(--gold);font-size:18px;font-weight:700;text-decoration:none;border-bottom:1px solid rgba(200,146,42,.4);padding-bottom:2px;transition:border-color .2s}
.about-cta a:hover{border-color:var(--gold)}
.legal{max-width:700px;margin:0 auto;padding:40px 20px;color:var(--text2);line-height:1.8}
.legal h1{font-size:28px;margin-bottom:8px;color:var(--text)}
.legal h2{font-size:16px;margin:28px 0 10px;color:var(--text);text-transform:uppercase;letter-spacing:1px}
.legal p{margin-bottom:14px;font-size:14px}
.legal ul{margin:0 0 14px 20px;font-size:14px}
.legal ul li{margin-bottom:6px}
.legal .date{font-size:12px;color:var(--text3);margin-bottom:28px}
#gate-scanner,#admin-scanner{width:100%!important;border-radius:var(--r);overflow:hidden}
#gate-scanner video,#admin-scanner video{width:100%!important;border-radius:var(--r)}
#gate-scanner img,#admin-scanner img{display:none}
@media print{nav.nav,footer.footer,.back,button{display:none!important}body{background:#fff!important}.tkt-disp{border:1px solid #ddd;break-inside:avoid;margin-bottom:16px}.sec{padding:0!important}#ticket-print-area .tkt-disp{background:#fff;color:#000}}
`;

export default CSS;
