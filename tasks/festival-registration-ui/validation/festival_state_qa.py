import json
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from festival_frontend_qa import Fixture,BASE,OUT,RESULT,screenshot,configure,enter_class,piece,add,nav,check
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1440,'height':1050})
 fixture=Fixture();context.route('**/*',fixture.route)
 page=context.new_page();page.set_default_timeout(10000);page.clock.install(time=datetime(2026,11,7,20,0,tzinfo=timezone.utc));page.on('dialog',lambda d:d.accept())
 try:
  page.goto(BASE+'/org/pafe/festival/spring-2027/register');configure(page);enter_class(page,'Piano Solo');piece(page)
  page.locator('#registration-piece-title').fill('Second work');page.locator('#registration-piece-composer').fill('Composer');page.locator('#registration-piece-minutes').fill('7');page.locator('#registration-piece-seconds').fill('0');page.get_by_role('button',name='Save piece',exact=True).click()
  expect(page.get_by_text('Total repertoire must be no more than 8 minutes.',exact=True)).to_be_visible();expect(page.locator('.parent-piece-summary')).to_have_count(1)
  check(True,'Total duration violation preserves first saved piece and rejects excess second piece')
  screenshot(page,'class-duration-validation')
  page.get_by_role('button',name='Discard piece changes',exact=True).click();add(page)
  fixture.sold_out.add('solo');page.locator('.parent-cart-link').click();expect(page.get_by_role('button',name='Continue to Checkout',exact=True)).to_be_disabled();expect(page.locator('.parent-cart-count')).to_have_text('1')
  check(True,'Capacity change blocks checkout and keeps local cart item')
  screenshot(page,'cart-capacity-blocked')
  fixture.sold_out.clear();nav(page,'Performers');page.locator('.parent-cart-link').click();expect(page.get_by_role('button',name='Continue to Checkout',exact=True)).to_be_enabled()
  check(True,'Capacity recovery re-enables checkout without rebuilding cart')
  fixture.csrf='csrf-new-parent';nav(page,'Performers');expect(page.locator('h1')).to_have_text('Performers');expect(page.locator('.parent-cart-count')).to_have_text('0')
  nav(page,'Registration');expect(page.locator('#registration-child')).to_have_value('');expect(page.locator('#registration-teacher')).to_have_value('')
  check(True,'Resolved new CSRF session identity clears prior user cart and context')
  configure(page);enter_class(page,'Piano Solo');piece(page);add(page);expect(page.locator('.parent-cart-count')).to_have_text('1')
  nav(page,'Festival Home');nav(page,'Registration');expect(page.locator('.parent-cart-count')).to_have_text('1');expect(page.locator('#registration-child')).to_have_value('emma');expect(page.locator('#registration-teacher')).to_have_value('teacher1')
  check(True,'Ordinary route session reload preserves local cart and context')
  fixture.authenticated=False;nav(page,'Performers');expect(page.get_by_text('Sign in using the header to view your account.',exact=True)).to_be_visible();expect(page.locator('.parent-cart-count')).to_have_text('0')
  check(True,'Resolved unauthenticated session clears prior user cart')
  fixture.authenticated=True;nav(page,'Registration');expect(page.locator('#registration-child')).to_have_value('')
  check(True,'Returning session starts without prior user context')
  configure(page);enter_class(page,'Piano Solo');piece(page);add(page);expect(page.locator('.parent-cart-count')).to_have_text('1');page.reload();expect(page.locator('.parent-cart-count')).to_have_text('0')
  check(True,'Browser reload clears memory-only cart')
  check(not fixture.unhandled,'All edge API requests handled by fixtures')
 except Exception as e:
  RESULT['failure']=str(e);page.screenshot(path=str(OUT/'state-failure.png'),full_page=True);raise
 finally:
  RESULT['requests']=fixture.calls;(OUT/'browser-state-results.json').write_text(json.dumps(RESULT,indent=2));browser.close()
print(json.dumps(RESULT['checks'],indent=2))
