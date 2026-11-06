import json, datetime, sys
from playwright.sync_api import sync_playwright
OUT=sys.argv[1]; DARK=len(sys.argv)>2
U="http://localhost:8770/"
def fake_calc(route):
    body=json.loads(route.request.post_data or "{}"); ins=body.get("inputs",{})
    tot=sum(v for v in ins.values() if isinstance(v,(int,float)))
    route.fulfill(json=({"values":{"D7":3663.5,"D34":2980,"D35":683.5}} if tot else {"values":{}}))
TX=[]; base=datetime.date(2026,11,3)
for m in range(4):
    d=(base-datetime.timedelta(days=30*m)).isoformat()
    TX+=[{"id":f"nf{m}","date":d,"description":"NETFLIX.COM","amount":-15.49},{"id":f"sp{m}","date":d,"description":"SPOTIFY USA","amount":-11.99},
         {"id":f"pf{m}","date":d,"description":"PLANET FITNESS","amount":-24.99},{"id":f"ic{m}","date":d,"description":"APPLE.COM/BILL ICLOUD","amount":-2.99},
         {"id":f"hu{m}","date":d,"description":"HULU","amount":-18.99}]
BANK={"accounts":[{"id":"a1","name":"Checking","last4":"4417","institution":"Chase","category":"cash","subcategory":"checking","balance":{"kind":"cash","current":1840.22},"balance_at":"2026-11-05T12:00:00Z"},
 {"id":"a3","name":"Savings","last4":"8810","institution":"Chase","category":"cash","subcategory":"savings","balance":{"kind":"cash","current":650},"balance_at":"2026-11-05T12:00:00Z"},
 {"id":"a2","name":"Visa","last4":"0021","institution":"Chase","category":"credit","balance":{"kind":"credit","owed":612.40},"balance_at":"2026-11-05T12:00:00Z"}],"review":TX}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    ctx=b.new_context(viewport={"width":390,"height":844},device_scale_factor=3,is_mobile=True,has_touch=True,color_scheme="dark" if DARK else "light")
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.route("**/functions/v1/calc-v2",fake_calc); pg.route("**/functions/v1/bank",lambda r:r.fulfill(json=BANK))
    def shot(n): pg.wait_for_timeout(500); pg.evaluate("""()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.nodeValue.includes("you@example.com"))n.nodeValue=n.nodeValue.replace("you@example.com","David")}}"""); pg.screenshot(path=f"{OUT}/{n}.jpg",type="jpeg",quality=92)
    def top(sel): pg.evaluate("s=>{const e=document.querySelector(s); if(e){window.scrollTo(0,e.getBoundingClientRect().top+scrollY-70)}}",sel); pg.wait_for_timeout(300)
    vis=lambda: [e for e in pg.query_selector_all("#sheet input.in[data-a]") if e.is_visible()]
    pg.goto(U+"app.html#monthly-budget"); pg.wait_for_timeout(1500)
    pg.select_option("#selMonth","10"); pg.wait_for_timeout(1200)
    for el,v in zip(vis(),[1832,1832,1100,380,220,150,120,60]): el.fill(str(v)); el.dispatch_event("input")
    pg.wait_for_timeout(1200); pg.click('#viewSeg [data-view="actual"]'); pg.wait_for_timeout(800)
    for el,v in zip(vis(),[1832,1832,1100,310,240,95,120,35]): el.fill(str(v)); el.dispatch_event("input")
    pg.wait_for_timeout(1200); pg.select_option("#selMonth","11"); pg.wait_for_timeout(1500)
    pg.click('#viewSeg [data-view="plan"]'); pg.wait_for_timeout(800)
    for el,v in zip(vis(),[1832,1832,1100,400,200,150,120,60]): el.fill(str(v)); el.dispatch_event("input")
    pg.wait_for_timeout(1200); pg.evaluate("window.scrollTo(0,0)"); shot("budget")
    pg.click('#viewSeg [data-view="actual"]'); pg.wait_for_timeout(1500); top("#rollPanel"); shot("rollover")
    # tools
    pg.click('[data-t="money"]'); pg.wait_for_timeout(1000); pg.fill('#payForm [name=gross]','52000'); pg.wait_for_timeout(500)
    top("#payOut"); shot("pay")
    pg.click('[data-msub="afford"]'); pg.wait_for_timeout(1500); pg.fill('#afForm [name=a]','1400'); pg.fill('#afForm [name=b]','150'); pg.wait_for_timeout(400); top("#afOut"); shot("afford")
    pg.click('[data-msub="subs"]'); pg.wait_for_timeout(2000); pg.evaluate("window.scrollTo(0,0)"); shot("subs")
    pg.click('[data-msub="networth"]'); pg.wait_for_timeout(1500); pg.evaluate("window.scrollTo(0,0)"); shot("networth")
    pg.click('[data-msub="reports"]'); pg.wait_for_timeout(2500); pg.evaluate("window.scrollTo(0,0)"); shot("reports")
    pg.click('[data-msub="learn"]'); pg.wait_for_timeout(800); pg.evaluate("window.scrollTo(0,0)")
    pg.click('#mBody [data-term="match"]'); shot("learn")
    pg.click('[data-t="home"]'); pg.wait_for_timeout(2500); top(".checkin"); shot("home")
    top(".road"); shot("roadmap")
    pg.click('[data-t="bills"]'); pg.wait_for_timeout(1000); top("#calPanel"); shot("bills")
    print("errors",errs); b.close()
