import json
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from festival_frontend_qa import Fixture,BASE,OUT,RESULT,screenshot,configure,enter_class,piece,add,nav,check
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1440,'height':1050})
 fixture=Fixture();fixture.children=[]
 context.route('**/*',fixture.route)
 page=context.new_page();page.set_default_timeout(10000);page.clock.install(time=datetime(2026,11,7,20,0,tzinfo=timezone.utc))
 try:
  page.goto(BASE+'/org/pafe/festival/spring-2027/register')
  expect(page.locator('h1')).to_have_text('Performers')
  check('/account/children' in page.url,'No performers redirects registration to separate Performers page')
  screenshot(page,'performers-empty')
  page.get_by_role('button',name='Add Performer',exact=True).first.click()
  page.get_by_label('First Name',exact=True).fill('Ava');page.get_by_label('Family Name',exact=True).fill('Chen');page.get_by_label('Birthday',exact=True).fill('2015-03-02')
  page.locator('form').get_by_role('button',name='Add Performer',exact=True).click()
  expect(page.get_by_text('Performer added.',exact=True)).to_be_visible()
  expect(page.get_by_text('Ava Chen',exact=True)).to_be_visible()
  page.get_by_role('link',name='Continue Registration →',exact=True).click()
  expect(page.locator('h1')).to_have_text('Registration')
  expect(page.locator('#registration-child')).to_have_value('new-performer')
  check(True,'Existing child-create API followed by Continue Registration restores festival and autoselects sole performer')
 except Exception as e:
  RESULT['failure']=str(e);page.screenshot(path=str(OUT/'edge-failure.png'),full_page=True);raise
 finally:
  RESULT['requests']=fixture.calls;(OUT/'browser-edge-results.json').write_text(json.dumps(RESULT,indent=2));browser.close()
print(json.dumps(RESULT['checks'],indent=2))
