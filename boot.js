/* Topo Trails — boot: Leaflet fallback loader, host lock, error reporter */
if(typeof L === 'undefined') document.write('<script src="https:\/\/cdnjs.cloudflare.com\/ajax\/libs\/leaflet\/1.9.4\/leaflet.js"><\/script><link rel="stylesheet" href="https:\/\/cdnjs.cloudflare.com\/ajax\/libs\/leaflet\/1.9.4\/leaflet.css">');

// this game is licensed to run only from its home server
(function(){
  var ALLOWED = ['trbaker.github.io'];
  if(ALLOWED.indexOf(location.hostname) === -1){
    window.__WRONG_HOST = true;
    document.addEventListener('DOMContentLoaded', function(){
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#69b7e8;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:sans-serif;color:#28325c;';
      d.innerHTML = '<div style="background:#fff;border:4px solid #28325c;border-radius:24px;padding:30px;max-width:420px;box-shadow:0 8px 0 rgba(40,50,92,.35);">' +
        '<div style="font-size:40px;">🏍️🔒</div>' +
        '<h2 style="margin:10px 0;">Topo Trails lives at its home track!</h2>' +
        '<p style="font-size:15px;line-height:1.5;">This game only runs at<br><a href="https://trbaker.github.io" style="color:#ff7a1a;font-weight:700;">https://trbaker.github.io</a></p></div>';
      document.body.appendChild(d);
    });
  }
})();

// visible error reporter: if anything crashes, say so on screen instead of failing silently
window.addEventListener('error', function(e){
  try{
    var b = document.getElementById('errBanner');
    if(!b){
      b = document.createElement('div');
      b.id = 'errBanner';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#e85d5d;color:#fff;font:700 13px sans-serif;padding:8px 12px;text-align:center;';
      document.body ? document.body.appendChild(b) : document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(b); });
    }
    b.textContent = '⚠️ ' + (e.message || 'Script failed to load') + (e.filename ? ' — ' + e.filename.split('/').pop() + ':' + e.lineno : '');
  }catch(_){}
}, true);
