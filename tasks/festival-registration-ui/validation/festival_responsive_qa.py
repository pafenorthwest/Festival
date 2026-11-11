import json
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from festival_frontend_qa import Fixture,BASE,OUT,RESULT,screenshot,check
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={'width':1101,'height':900});fixture=Fixture();context.route('**/*',fixture.route);page=context.new_page();page.clock.install(time=datetime(2026,11,7,20,0,tzinfo=timezone.utc))
 try:
  page.goto(BASE+'/org/pafe/festival/spring-2027')
  label=page.locator('.organization-side-navigation-label').filter(has_text='Festival Home')
  expect(label).to_be_visible();expect(page.locator('.parent-menu-toggle')).to_be_hidden();check(True,'1101px displays expanded sidebar')
  page.get_by_role('button',name='Collapse navigation',exact=True).click();expect(label).to_be_hidden();page.get_by_role('button',name='Expand navigation',exact=True).click();expect(label).to_be_visible();check(True,'Wide sidebar collapse and expand work')
  for width in [1100,761]:
   page.set_viewport_size({'width':width,'height':900});expect(label).to_be_hidden();expect(page.locator('.parent-side-navigation')).to_be_visible();expect(page.locator('.parent-menu-toggle')).to_be_hidden();check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),str(width)+'px displays icon rail without hamburger or overflow')
  page.set_viewport_size({'width':760,'height':900});expect(page.locator('.parent-side-navigation')).to_be_hidden();expect(page.locator('.parent-menu-toggle')).to_be_visible();page.locator('.parent-menu-toggle').click();expect(label).to_be_visible();check(True,'760px switches to hamburger opening full labeled navigation')
  page.locator('.parent-side-navigation').get_by_role('link',name='Performers',exact=True).click();expect(page.locator('h1')).to_have_text('Performers');expect(page.locator('.parent-side-navigation')).to_be_hidden();check(True,'Successful mobile route navigation closes menu')
  page.set_viewport_size({'width':390,'height':844});screenshot(page,'performers-mobile')
  check(not fixture.unhandled,'Responsive API calls all intercepted')
 except Exception as e:
  RESULT['failure']=str(e);page.screenshot(path=str(OUT/'responsive-failure.png'));raise
 finally:
  (OUT/'browser-responsive-results.json').write_text(json.dumps(RESULT,indent=2));browser.close()
print(json.dumps(RESULT['checks'],indent=2))
