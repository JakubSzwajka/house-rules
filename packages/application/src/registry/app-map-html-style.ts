export const mapStyle = `
:root{color-scheme:light dark;--bg:#f5f4f0;--surface:#fff;--sunk:#ecebe6;--ink:#1c1e22;--muted:#5a606b;--line:#d9d6ce;--accent:#2d5bc9;--accent-soft:#dbe5fb;--wire:#2d5bc9;--read:#3f6f4f;--read-bg:#e5efe7;--unit:#2d5bc9;--unit-bg:#e3eafb;--danger:#a8281f;--danger-bg:#fae4e1;--warn:#7f5200;--warn-bg:#fbefd5;--add:#1d6e37;--add-bg:#e2f3e7;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#141619;--surface:#1c1f23;--sunk:#22262b;--ink:#e6e4df;--muted:#a2a8b1;--line:#343940;--accent:#8eaefc;--accent-soft:#25335a;--wire:#8eaefc;--read:#9fd0ad;--read-bg:#1f3326;--unit:#a9c0fb;--unit-bg:#222f4d;--danger:#f2a49c;--danger-bg:#43211e;--warn:#f0c674;--warn-bg:#3d3018;--add:#9fd8ae;--add-bg:#1d3a26}}
*{box-sizing:border-box}
html{background:var(--bg);color:var(--ink);font:14px/1.45 var(--sans);-webkit-text-size-adjust:100%}
body{margin:0}
::selection{background:var(--accent-soft);color:var(--ink)}
code,.pick,.ref{font-family:var(--mono);font-size:.92em}
a{color:var(--accent);text-underline-offset:2px}
a:focus-visible,.pick:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.page{max-width:1480px;margin:0 auto;padding:28px 32px 64px}
header.top h1{font-size:1.6rem;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}
.lead{margin:0 0 4px;color:var(--muted);max-width:75ch}
.counts{display:flex;flex-wrap:wrap;gap:6px 18px;margin:14px 0 0;padding:0;list-style:none}
.counts strong{font-variant-numeric:tabular-nums;font-size:1.05rem}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin:14px 0 0;color:var(--muted);font-size:12.5px}
.legend svg{vertical-align:middle}
.status{position:sticky;top:0;z-index:5;margin:22px 0 0;padding:9px 12px;background:var(--sunk);border-radius:8px;color:var(--muted);font-size:13px;min-height:2.4em}
.status strong{color:var(--ink);font-family:var(--mono);font-weight:600}
.map{position:relative;display:grid;grid-template-columns:minmax(210px,.95fr) minmax(320px,1.5fr) minmax(300px,1.35fr);column-gap:64px;margin-top:18px;padding-right:36px}
.col{position:relative;z-index:1;min-width:0}
.col>h2{font-size:1.05rem;margin:0 0 2px}
.col>.note{margin:0 0 10px}
.wires{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:visible}
.wires path{fill:none;stroke:var(--wire);stroke-width:1.4;opacity:.75}
.wires path.sys{stroke-dasharray:5 4}
h3.group{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:18px 0 2px}
.note{margin:0 0 8px;color:var(--muted);font-size:12.5px}
.muted{color:var(--muted)}
.nodes{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.node{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 12px 9px;transition:opacity .15s ease-out,border-color .15s ease-out,background-color .15s ease-out}
.node-head{margin:0;font-size:14px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.pick{all:unset;cursor:pointer;font-family:var(--mono);font-weight:650;overflow-wrap:anywhere}
.pick:hover{color:var(--accent)}
.module{margin:0 0 14px}
.module-head{margin:0;font-size:1rem;display:flex;gap:8px;align-items:baseline}
.badges{display:inline-flex;flex-wrap:wrap;gap:5px;align-items:center;font-family:var(--sans)}
.address{margin:4px 0 0;font-size:12.5px}
.source{margin:5px 0 0;font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11.5px;font-weight:600;line-height:1.5;background:var(--sunk);color:var(--muted)}
.badge-read{background:var(--read-bg);color:var(--read)}
.badge-unit{background:var(--unit-bg);color:var(--unit)}
.badge-destructive{background:var(--danger-bg);color:var(--danger)}
.badge-approval{background:var(--warn-bg);color:var(--warn)}
.facts{display:grid;grid-template-columns:7.5em minmax(0,1fr);gap:2px 10px;margin:6px 0 0;font-size:12.5px}
.facts dt{color:var(--muted)}
.facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
.edges{list-style:none;margin:0;padding:0}
.as-system{color:var(--warn)}
.focused .node:not(.related):not(.chosen){opacity:.32}
.node.related{border-color:var(--accent)}
.node.chosen{border-color:var(--accent);background:var(--accent-soft)}
.module.related>.module-head{color:var(--accent)}
.mark{font-family:var(--sans);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:1px 7px;border-radius:999px}
.mark-added{background:var(--add-bg);color:var(--add)}
.mark-removed{background:var(--danger-bg);color:var(--danger)}
.mark-changed{background:var(--warn-bg);color:var(--warn)}
.node.is-added{background:var(--add-bg)}
.node.is-removed{background:var(--danger-bg)}
.node.is-removed .pick{text-decoration:line-through}
.node.is-changed{background:var(--warn-bg)}
section.below{margin-top:40px}
section.below h2{font-size:1.05rem;margin:0 0 8px}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;vertical-align:top;padding:6px 10px;border-bottom:1px solid var(--line)}
th{font-weight:600;color:var(--muted);font-size:12px}
tr.is-added>*{background:var(--add-bg)}
tr.is-removed>*{background:var(--danger-bg)}
tr.is-changed>*{background:var(--warn-bg)}
.changes table{table-layout:fixed}
.changes col.name{width:26%}
.changes col.field{width:14%}
.changes{margin-top:22px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 20px}
.changes h2{font-size:1.05rem;margin:0 0 8px}
.changes ul.summary{margin:0;padding-left:18px}
.changes ul.summary li{margin:3px 0}
.changes h3{font-size:.9rem;margin:16px 0 6px}
.changes .old{color:var(--danger)}
.changes .new{color:var(--add)}
@media (max-width:1000px){.page{padding:20px 16px 48px}.map{grid-template-columns:minmax(0,1fr);row-gap:28px;padding-right:0}.wires{display:none}}
@media (prefers-reduced-motion:reduce){.node{transition:none}}
`;

export const mapScript = `
(function(){
var root=document.querySelector("[data-map]");if(!root)return;
var svg=root.querySelector("svg.wires");var status=document.getElementById("map-status");
var wires=JSON.parse(document.getElementById("map-wires").textContent);
var nodes={};root.querySelectorAll("[data-node],[data-module]").forEach(function(n){nodes[n.id]=n;});
var wide=window.matchMedia("(min-width: 1001px)");var shown=null;var pinned=null;
var idle=status?status.textContent:"";
function pl(n,w){return n+" "+w+(n===1?"":"s");}
function relOf(id){var n=nodes[id];var r=new Set([id]);if(n&&n.dataset.rel){n.dataset.rel.split(" ").forEach(function(x){if(x)r.add(x);});}return r;}
function draw(){
while(svg.firstChild)svg.removeChild(svg.firstChild);
if(shown===null||!wide.matches)return;
var rel=relOf(shown);var box=root.getBoundingClientRect();var ns="http://www.w3.org/2000/svg";
wires.forEach(function(w){
if(!rel.has(w[0])||!rel.has(w[1]))return;
var a=nodes[w[0]].getBoundingClientRect();var b=nodes[w[1]].getBoundingClientRect();
var ay=a.top+Math.min(a.height/2,22)-box.top;var by=b.top+Math.min(b.height/2,22)-box.top;var d;
if(Math.abs(a.left-b.left)<4){var x=a.right-box.left;var bend=Math.min(30,8+Math.abs(by-ay)/12);d="M"+x+" "+ay+"C"+(x+bend)+" "+ay+" "+(x+bend)+" "+by+" "+x+" "+by;}
else{var x1=a.right-box.left;var x2=b.left-box.left;var mid=(x2-x1)/2;d="M"+x1+" "+ay+"C"+(x1+mid)+" "+ay+" "+(x2-mid)+" "+by+" "+x2+" "+by;}
var p=document.createElementNS(ns,"path");p.setAttribute("d",d);if(w[2])p.setAttribute("class","sys");svg.appendChild(p);});
}
function show(id){
shown=id;var rel=id===null?null:relOf(id);root.classList.toggle("focused",rel!==null);
Object.keys(nodes).forEach(function(k){var n=nodes[k];n.classList.toggle("related",rel!==null&&rel.has(k)&&k!==id);n.classList.toggle("chosen",k===id);
var b=n.querySelector(":scope > .node-head .pick");if(b)b.setAttribute("aria-pressed",String(k===pinned));});
if(status){if(id===null){status.textContent=idle;}else{var c={w:0,f:0,o:0,m:0};rel.forEach(function(k){if(k!==id)c[k.charAt(0)]++;});
status.innerHTML="";var s=document.createElement("strong");s.textContent=nodes[id].dataset.name;status.appendChild(s);
status.appendChild(document.createTextNode(" reaches "+pl(c.w,"way")+", "+pl(c.f,"feature")+" and "+pl(c.o,"operation")+" in "+pl(c.m,"module")+"."+(pinned===id?" Selected; press Esc or select it again to clear.":"")));}}
draw();}
root.addEventListener("mouseover",function(e){if(pinned!==null)return;var n=e.target.closest("[data-node]");if(n&&n.id!==shown)show(n.id);});
root.addEventListener("mouseleave",function(){if(pinned===null)show(null);});
root.addEventListener("focusin",function(e){if(pinned!==null)return;var n=e.target.closest("[data-node]");if(n)show(n.id);});
root.addEventListener("click",function(e){var b=e.target.closest(".pick");if(!b)return;var id=b.closest("[data-node]").id;pinned=pinned===id?null:id;show(pinned===null?id:pinned);});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&(pinned!==null||shown!==null)){pinned=null;show(null);}});
window.addEventListener("resize",draw);wide.addEventListener("change",draw);
})();
`;
