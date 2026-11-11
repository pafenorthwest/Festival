from datetime import datetime,timezone
from playwright.sync_api import sync_playwright,expect
from festival_frontend_qa import Fixture,BASE,OUT,RESULT,screenshot,configure,enter_class,piece,nav
import json
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={'width':1440,'height':1050});fixture=Fixture();context.route('**/*',fixture.route);page=context.new_page();page.clock.install(time=datetime(2026,11,7,20,0,tzinfo=timezone.utc));page.on('dialog',lambda d:d.accept())
 page.goto(BASE+'/org/pafe/festival/spring-2027/register');configure(page);screenshot(page,'registration');enter_class(page,'Piano Solo');piece(page);screenshot(page,'class-registration');nav(page,'My Registrations');page.set_viewport_size({'width':390,'height':844});expect(page.locator('h1')).to_have_text('My Registrations');screenshot(page,'my-registrations-mobile')
 brand=page.locator('.parent-brand').bounding_box();actions=page.locator('.parent-header-actions').bounding_box();header=page.locator('.parent-header').bounding_box();assert brand['y']<actions['y']+actions['height'] and actions['y']<brand['y']+brand['height'],'Mobile header buttons and brand not on one row'
 RESULT['checks'].append('Latest CSS keeps 390px brand and action controls on one header row');RESULT['headerBounds']=header
 (OUT/'browser-visual-refresh-results.json').write_text(json.dumps(RESULT,indent=2));browser.close()
print(json.dumps(RESULT,indent=2))
