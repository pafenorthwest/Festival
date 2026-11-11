from pathlib import Path
import base64, copy, json, re, sys
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, expect
from PIL import Image, ImageOps, ImageDraw
ROOT=Path('/Users/eric/pafenorthwest/Festival')
OUT=ROOT/'tasks/festival-registration-ui/validation'
OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:5175'
FEST={'id':'fest27','code':'PAFE27','shortName':'spring-2027','isPrimary':True,'name':'Spring Festival 2027','startDate':'2027-05-15','endDate':'2027-05-20','registrationOpensAt':'2026-01-01T00:00:00Z','registrationClosesAt':'2027-05-01T00:00:00Z','createdAtIso':'2026-01-01T00:00:00Z'}
PAST={**FEST,'id':'fest26','shortName':'spring-2026','isPrimary':False,'name':'Spring Festival 2026','startDate':'2026-05-15','endDate':'2026-05-20'}
def cls(id,name,division='piano',price='45.00',subtype='solo',maximum=2,full=False):
 return {'id':id,'displayName':name,'divisionId':division,'classSubtypeId':subtype,'classSubtypeName':subtype.title(),'minimumAge':9,'maximumAge':12,'price':price,'maximumPerformancePieces':maximum,'performanceMinutes':8,'capacity':0 if full else 30,'placedCount':0,'availability':'waitlist' if full else 'available','isRegistrationOpen':True,'requiresConcerto':subtype=='concerto'}
CLASSES=[cls('solo','Piano Solo'),cls('concerto','Piano Concerto',price='55.00',subtype='concerto',maximum=1),cls('ensemble','Piano Ensemble',price='35.00',subtype='ensemble',full=True),cls('sonata','Piano Sonata',subtype='sonata'),cls('baroque','Baroque Piano',price='40.00',subtype='baroque',maximum=1),cls('violin','Violin Solo','violin','40.00',maximum=1)]
CATALOG={'id':'mozart488','organizationId':'org1','title':'Concerto in A Major, K. 488','composerName':'Wolfgang Amadeus Mozart','classifications':['concerto'],'isActive':True}
PIECE={'title':'Sonata in C Major, K. 545','composer':'Wolfgang Amadeus Mozart','movement':'I. Allegro','durationSeconds':240}
def purchased(id,child='emma',old=False):
 c=copy.deepcopy(next(c for c in CLASSES if c['id']==('baroque' if old else 'sonata')))
 c.update(festivalId='fest26' if old else 'fest27',isActive=True)
 return {'entitlement':{'id':id,'festivalId':c['festivalId'],'festivalClassId':c['id'],'childId':child,'status':'confirmed','createdAt':'2026-10-01T00:00:00Z','updatedAt':'2026-10-01T00:00:00Z'},'festivalClass':c,'child':{'id':child,'name':'Emma Chen' if child=='emma' else 'Leo Chen'},'metadata':{'id':'meta-'+id,'festivalId':c['festivalId'],'classEntitlementId':id,'teacherMembershipId':'tm1','teacherName':None if old else 'Maya Thompson','accompanistMembershipId':None,'repertoireJson':[copy.deepcopy(PIECE)],'repertoireItems':[]},'paidAtIso':'2026-10-01T00:00:00Z','metadataEditCutoffIso':'2026-04-03T07:00:00Z' if old else '2027-04-03T07:00:00Z','canEditMetadata':not old}
class Fixture:
 def __init__(self):
  self.children=[{'id':'emma','displayName':'Emma Chen','hasCurrentValidAgeSnapshot':True},{'id':'leo','displayName':'Leo Chen','hasCurrentValidAgeSnapshot':True}]
  self.registrations=[purchased('reg-emma'),purchased('reg-old',old=True),purchased('reg-leo','leo')]
  self.csrf='csrf-parent-1';self.authenticated=True;self.calls=[];self.unhandled=[];self.waitlist=[];self.sold_out=set();self.checkout_status=503;self.hold_add=False;self.hold_patch=False;self.pending=[]
 def eligible(self,items):
  results=[]
  for item in items:
   cid=item['festivalClassId']; child=item['childId']; c=next((c for c in CLASSES if c['id']==cid),None)
   code='AVAILABLE';message='Class is available for registration.';availability='available'
   bought=any(r['entitlement']['childId']==child and r['entitlement']['festivalClassId']==cid and r['entitlement']['festivalId']=='fest27' for r in self.registrations)
   if bought:code='ALREADY_REGISTERED';message='This class has already been purchased.'
   elif cid=='concerto' and not any(i['childId']==child and i['festivalClassId']=='solo' and not i.get('isCandidate') for i in items):code='MISSING_PREREQUISITE';message='Piano Concerto requires Piano Solo in the same division and age group.'
   elif cid=='ensemble' or cid in self.sold_out:code='SOLD_OUT';message='Class capacity is full.';availability='waitlist'
   result={'childId':child,'festivalClassId':cid,'eligible':code=='AVAILABLE','isEligible':code=='AVAILABLE','reasonCode':code,'message':message,'availability':availability}
   if item.get('id'):result['lineItemId']=item['id']
   if code=='MISSING_PREREQUISITE':result['missingPrerequisite']={'requiredSubtypeId':'solo','requiredSubtypeName':'Piano Solo'}
   results.append(result)
  return {'results':results}
 def route(self,route):
  req=route.request;url=urlparse(req.url);path=url.path;method=req.method
  if '/api/' in path:
   data=req.post_data_json if req.post_data else None
   self.calls.append({'method':method,'path':path,'data':data,'headers':{k:v for k,v in req.headers.items() if k in ['x-csrf-token','idempotency-key']}})
   status=200;result=None
   if path=='/api/bootstrap':result={'session':{'authenticated':False}}
   elif path.endswith('/landing'):result={'organization':{'name':'Pacific Northwest Music Festival','slug':path.split('/')[3]},'festivals':[FEST,PAST]}
   elif path.endswith('/primary'):result={'status':301,'path':'/org/pafe/festival/spring-2027'}
   elif path.endswith('/customer/session'):result={'session':{'authenticated':True,'csrfToken':self.csrf,'expiresAtIso':'2028-01-01T00:00:00Z'} if self.authenticated else {'authenticated':False}}
   elif path.endswith('/divisions'):result={'divisions':[{'id':'piano','displayName':'Piano','displayOrder':0},{'id':'violin','displayName':'Violin','displayOrder':1}],'instruments':[{'id':'piano','displayName':'Piano','displayOrder':0},{'id':'violin','displayName':'Violin','displayOrder':1}]}
   elif path.endswith('/customer/children'):
    if method=='POST':
     child={'id':'new-performer','displayName':data['displayName'],'hasCurrentValidAgeSnapshot':True};self.children.append(child);result={'child':child}
    else:result={'children':self.children}
   elif path.endswith('/age-snapshot'):result={'success':True}
   elif path.endswith('/customer/profile'):result={'profile':{'name':'Jordan Chen','email':'jordan@example.com','phone':'206-555-0142','mailingAddress':None,'updatedAtIso':'2026-11-01T00:00:00Z'}}
   elif path.endswith('/registration/teachers'):result={'teachers':[{'id':'teacher1','name':'Maya Thompson'},{'id':'teacher2','name':'David Kim'}]}
   elif path.endswith('/registration/eligible-classes'):
    division=parse_qs(url.query).get('divisionId',['piano'])[0];result={'classes':[c for c in CLASSES if c['divisionId']==division]}
   elif path.endswith('/registration/accompanists'):result={'accompanists':[{'id':'acc1','name':'Alex Rivera'},{'id':'acc2','name':'Ruth Anderson'}]}
   elif path.endswith('/registration/concerto-catalog'):result={'works':[CATALOG]}
   elif path.endswith('/registration/eligibility'):
    result=self.eligible(data['items'])
    if self.hold_add and any(i.get('pieces') for i in data['items']):
     self.pending.append((route,result));return
   elif path.endswith('/registration/checkout'):
    status=self.checkout_status;result={'error':'Checkout unavailable for fixture retry test.'} if status!=200 else {'checkoutUrl':BASE+'/qa-shopify','correlationId':'fixture-checkout'}
   elif path.endswith('/class-registrations'):
    scoped='/festivals/' in path;result={'registrations':[r for r in self.registrations if not scoped or r['entitlement']['festivalId']=='fest27']}
   elif '/class-registrations/' in path and path.endswith('/metadata'):
    id=path.split('/')[-2];r=next(r for r in self.registrations if r['entitlement']['id']==id)
    r['metadata']['repertoireJson']=data.get('pieces',r['metadata']['repertoireJson'])
    if 'accompanistId' in data:r['metadata']['accompanistMembershipId']=data['accompanistId']
    result={'metadata':r['metadata']}
    if self.hold_patch:self.pending.append((route,result));return
   elif '/classes/' in path and path.endswith('/waitlist'):
    entry={'id':'wait1','festivalClassId':path.split('/')[-2],'childId':data['childId'],'status':'active','joinedAt':'2026-11-07T20:00:00Z'}
    self.waitlist.append(entry);result={'entry':entry,'success':True}
   elif path.endswith('/waitlist'):result={'entries':self.waitlist}
   elif re.search(r'/festivals/[^/]+$',path):result={'festival':PAST if path.endswith('spring-2026') else FEST}
   elif path.endswith('/customer/membership-status'):result={'memberships':[]}
   else:self.unhandled.append({'method':method,'path':path});status=404;result={'error':'Unhandled QA fixture route'}
   route.fulfill(status=status,content_type='application/json',body=json.dumps(result));return
  if url.hostname=='fonts.googleapis.com':
   font=base64.b64encode((Path('/private/tmp/festival-symbols-full.ttf')).read_bytes()).decode()
   route.fulfill(content_type='text/css',body='@font-face{font-family:"Material Symbols Outlined";font-style:normal;font-weight:400;src:url(data:font/ttf;base64,'+font+')}');return
  if url.hostname not in ['127.0.0.1','localhost']:route.abort();return
  route.continue_()
RESULT={'checks':[],'errors':[],'screenshots':[]}
def check(condition,message):
 if not condition:raise AssertionError(message)
 RESULT['checks'].append(message)
def screenshot(page,name):
 page.evaluate('document.fonts.ready');page.wait_for_timeout(180)
 check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),name+': no horizontal overflow')
 path=OUT/(name+'.png');page.screenshot(path=str(path),full_page=True,animations='disabled');RESULT['screenshots'].append(str(path));print('SCREENSHOT '+str(path),flush=True)
def configure(page,child='emma',division='piano'):
 page.locator('#registration-child').select_option(child)
 page.locator('#registration-division').select_option(division)
 expect(page.locator('#registration-teacher option[value="teacher1"]')).to_be_attached()
 page.locator('#registration-teacher').select_option('teacher1')
 expect(page.get_by_role('heading',name='Piano Solo',exact=True) if division=='piano' else page.get_by_role('heading',name='Violin Solo',exact=True)).to_be_visible()
 page.wait_for_timeout(150)
def enter_class(page,name):
 row=page.locator('article').filter(has=page.get_by_role('heading',name=name,exact=True))
 row.get_by_role('button',name='Register',exact=True).click()
 expect(page.locator('h1')).to_have_text(name)
def piece(page,title='Minuet in G',composer='Christian Petzold',minutes='2',catalog=None):
 if page.locator('#registration-instrument').count():page.locator('#registration-instrument').select_option('piano')
 if catalog:
  expect(page.locator('#registration-piece-catalog option[value="'+catalog+'"]').first).to_be_attached()
  page.locator('#registration-piece-catalog').select_option(catalog)
 else:
  page.locator('#registration-piece-title').fill(title);page.locator('#registration-piece-composer').fill(composer)
 page.locator('#registration-piece-minutes').fill(minutes);page.locator('#registration-piece-seconds').fill('0')
 page.get_by_role('button',name='Save piece',exact=True).click()
 expect(page.locator('.parent-piece-summary')).to_have_count(1)
def add(page):
 page.get_by_role('button',name='Add to Cart',exact=True).click()
 expect(page.locator('h1')).to_have_text('Registration')
 expect(page.locator('#registration-child')).to_be_visible()
def nav(page,label):page.locator('.parent-side-navigation').get_by_role('link',name=label,exact=True).click()
def run(first_only=False):
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  context=browser.new_context(viewport={'width':1440,'height':1050},device_scale_factor=1)
  fixture=Fixture();context.route('**/*',fixture.route)
  page=context.new_page();page.set_default_timeout(10000)
  page.clock.install(time=datetime(2026,11,7,20,0,tzinfo=timezone.utc))
  page.on('pageerror',lambda error:RESULT['errors'].append(str(error)))
  dialog_answers=[];dialogs=[]
  def on_dialog(dialog):
   dialogs.append({'type':dialog.type,'message':dialog.message})
   dialog.accept() if not dialog_answers or dialog_answers.pop(0) else dialog.dismiss()
  page.on('dialog',on_dialog)
  try:
   page.goto(BASE+'/org/pafe/festival/spring-2027')
   expect(page.locator('h1')).to_have_text('Spring Festival 2027')
   screenshot(page,'festival-home')
   if first_only:return
   page.get_by_role('link',name='Parents',exact=True).click()
   expect(page.locator('h1')).to_have_text('Registration')
   screenshot(page,'registration-empty')
   configure(page)
   screenshot(page,'registration')
   check(page.locator('article').filter(has=page.get_by_role('heading',name='Piano Concerto',exact=True)).get_by_role('button',name='Register',exact=True).is_disabled(),'Prerequisite class disabled before solo')
   enter_class(page,'Piano Solo');piece(page)
   expect(page.locator('#registration-piece-title')).to_have_value('')
   screenshot(page,'class-registration')
   check(not any(c['path'].endswith('/registration/checkout') for c in fixture.calls),'No checkout write before local Add')
   fixture.hold_add=True
   page.get_by_role('button',name='Add to Cart',exact=True).click()
   expect(page.get_by_role('button',name='Checking eligibility…',exact=True)).to_be_disabled()
   expect(page.locator('#registration-piece-title')).to_be_disabled()
   expect(page.locator('#registration-instrument')).to_be_disabled()
   check(True,'Pending Add prevents edits to captured form')
   fixture.hold_add=False
   for pending,response in fixture.pending:pending.fulfill(status=200,content_type='application/json',body=json.dumps(response))
   fixture.pending.clear()
   expect(page.locator('h1')).to_have_text('Registration')
   expect(page.locator('.parent-cart-count')).to_have_text('1')
   check(not any(c['path'].endswith('/registration/checkout') for c in fixture.calls),'Local Add does not create Shopify checkout')
   expect(page.locator('#registration-child')).to_have_value('emma')
   expect(page.locator('#registration-teacher')).to_have_value('teacher1')
   check(True,'Registration context retained after Add')
   enter_class(page,'Piano Concerto');piece(page,catalog='mozart488',minutes='3');add(page)
   page.locator('.parent-cart-link').click();expect(page.locator('h1')).to_have_text('Your cart')
   screenshot(page,'cart')
   rows=page.locator('.parent-list-row');solo=rows.filter(has=page.get_by_role('heading',name='Piano Solo',exact=True))
   solo.get_by_role('button',name='Remove',exact=True).click()
   expect(page.get_by_role('heading',name='Piano Concerto',exact=True)).to_be_visible()
   expect(page.get_by_role('button',name='Continue to Checkout',exact=True)).to_be_disabled()
   screenshot(page,'cart-prerequisite-blocked')
   check(page.locator('.parent-cart-count').inner_text()=='1','Removing prerequisite retains dependent cart entry')
   page.get_by_role('button',name='Continue registration',exact=True).click()
   enter_class(page,'Piano Solo');piece(page);add(page)
   page.locator('.parent-cart-link').click()
   expect(page.get_by_role('button',name='Continue to Checkout',exact=True)).to_be_enabled()
   nav(page,'Performers');expect(page.locator('h1')).to_have_text('Performers');screenshot(page,'performers')
   page.locator('.parent-cart-link').click();expect(page.locator('.parent-cart-count')).to_have_text('2')
   nav(page,'My Registrations');expect(page.locator('h1')).to_have_text('My Registrations');expect(page.get_by_role('button',name='Edit',exact=True)).to_have_count(2)
   screenshot(page,'my-registrations')
   page.locator('.registration-edit-info').first.hover();expect(page.locator('[role="tooltip"]').first).to_be_visible();screenshot(page,'my-registrations-tooltip')
   check(page.locator('.parent-cart-count').inner_text()=='2','Global cart survives Performers and My Registrations SPA navigation')
   firstrow=page.locator('.registration-row').filter(has=page.get_by_role('heading',name='Piano Sonata',exact=True)).first
   firstrow.get_by_role('button',name='Edit',exact=True).click()
   expect(page.locator('h1')).to_have_text('Repertoire & accompanist');screenshot(page,'edit-registration')
   page.locator('#purchased-repertoire-title').fill('Updated Sonata')
   page.get_by_role('button',name='Save piece',exact=True).click()
   page.locator('#purchased-accompanist').select_option('acc1')
   fixture.hold_patch=True
   page.get_by_role('button',name='Save Changes',exact=True).click()
   expect(page.get_by_role('button',name='Saving…',exact=True)).to_be_disabled()
   prior_dialogs=len(dialogs);prior_calls=len(fixture.calls)
   nav(page,'Performers');expect(page.locator('h1')).to_have_text('Repertoire & accompanist')
   page.get_by_role('button',name='Sign out',exact=True).click()
   expect(page.get_by_text('Please wait for your registration changes to finish saving before signing out.')).to_be_visible()
   check(len(dialogs)==prior_dialogs,'Pending purchased save blocks navigation without discard dialog')
   check(not any('/logout' in c['path'] for c in fixture.calls[prior_calls:]),'Pending purchased save prevents logout POST')
   fixture.hold_patch=False
   for pending,response in fixture.pending:pending.fulfill(status=200,content_type='application/json',body=json.dumps(response))
   fixture.pending.clear()
   expect(page.locator('h1')).to_have_text('My Registrations')
   patch=next(c for c in reversed(fixture.calls) if c['method']=='PATCH')
   check(set(patch['data'])=={'pieces','accompanistId'},'Purchased PATCH changes only repertoire and accompanist')
   check(patch['data']['pieces'][0]['title']=='Updated Sonata' and patch['data']['accompanistId']=='acc1','Purchased updates sent through existing metadata API')
   page.get_by_role('button',name='View details',exact=True).click();expect(page.locator('h1')).to_have_text('Repertoire & accompanist')
   expect(page.locator('#purchased-accompanist')).to_be_disabled();check(page.get_by_role('button',name='Save Changes',exact=True).count()==0,'Closed registration read-only')
   screenshot(page,'edit-registration-closed')
   page.get_by_role('button',name='← My Registrations',exact=True).click()
   nav(page,'Registration');configure(page)
   row=page.locator('article').filter(has=page.get_by_role('heading',name='Piano Ensemble',exact=True));row.get_by_role('button',name='Join Waitlist',exact=True).click()
   expect(page.get_by_role('heading',name='Piano Ensemble Waitlist',exact=True)).to_be_visible()
   check(page.locator('.waitlist-card').get_by_label('Title',exact=True).count()==0,'Waitlist has no repertoire fields')
   page.locator('.waitlist-card input[type="checkbox"]').check();page.get_by_role('button',name='Join waitlist ($0)',exact=True).click()
   expect(page.get_by_text('You are currently on the waitlist for this class.')).to_be_visible()
   waitcall=next(c for c in reversed(fixture.calls) if c['method']=='POST' and c['path'].endswith('/waitlist'))
   check('pieces' not in waitcall['data'] and 'teacherId' not in waitcall['data'],'Waitlist uses existing contact-consent contract')
   screenshot(page,'waitlist')
   page.get_by_role('button',name='Close waitlist',exact=True).click()
   enter_class(page,'Baroque Piano');page.locator('#registration-piece-title').fill('Unsaved work')
   prior_calls=len(fixture.calls);dialog_answers.append(False)
   page.get_by_role('button',name='Sign out',exact=True).click()
   expect(page.locator('h1')).to_have_text('Baroque Piano')
   check(not any('/logout' in c['path'] for c in fixture.calls[prior_calls:]),'Dirty class Sign out cancel prevents logout POST')
   dialog_answers.append(False);nav(page,'Performers');expect(page.locator('h1')).to_have_text('Baroque Piano');expect(page.locator('#registration-piece-title')).to_have_value('Unsaved work')
   dialog_answers.append(True);nav(page,'Performers');expect(page.locator('h1')).to_have_text('Performers');check(True,'Dirty form cancel and discard both work')
   nav(page,'Registration');configure(page,'leo','violin');enter_class(page,'Violin Solo');piece(page,title='Gavotte',composer='Gossec');add(page)
   page.locator('.parent-cart-link').click();expect(page.locator('.parent-cart-count')).to_have_text('3')
   page.get_by_role('button',name='Continue to Checkout',exact=True).click();expect(page.locator('.cart-checkout-error-banner')).to_be_visible()
   page.get_by_role('button',name='Continue to Checkout',exact=True).click();expect(page.locator('.cart-checkout-error-banner')).to_be_visible()
   attempts=[c for c in fixture.calls if c['path'].endswith('/registration/checkout')]
   check(len(attempts)==2 and attempts[0]['headers']['idempotency-key']==attempts[1]['headers']['idempotency-key'],'Checkout retries reuse same idempotency key')
   check(any(piece.get('catalogWorkId')=='mozart488' for c in attempts for item in c['data']['lineItems'] for piece in item['pieces']),'Catalog ID survives cart and checkout payload')
   fixture.checkout_status=200;prior_dialogs=len(dialogs)
   page.get_by_role('button',name='Continue to Checkout',exact=True).click()
   page.wait_for_url(BASE+'/qa-shopify')
   check(not any(d['type']=='beforeunload' for d in dialogs[prior_dialogs:]),'Intentional Shopify handoff has no beforeunload prompt')
   page.goto(BASE+'/org/pafe/account/classes')
   for width,label in [(1024,'rail'),(390,'mobile')]:
    page.set_viewport_size({'width':width,'height':900 if width==1024 else 844})
    nav(page,'My Registrations') if width>760 else page.goto(BASE+'/org/pafe/account/classes')
    expect(page.locator('h1')).to_have_text('My Registrations');screenshot(page,'my-registrations-'+label)
    if width==390:
     page.locator('.parent-menu-toggle').click();expect(page.locator('.parent-side-navigation')).to_be_visible();screenshot(page,'mobile-navigation')
   check(not RESULT['errors'],'No browser JavaScript errors')
   check(not fixture.unhandled,'All API requests handled by explicit fixture contracts')
   RESULT['requests']=fixture.calls;RESULT['dialogs']=dialogs
  except Exception as error:
   RESULT['failure']=str(error);RESULT['requests']=fixture.calls;RESULT['dialogs']=dialogs;page.screenshot(path=str(OUT/'failure.png'),full_page=True);raise
  finally:
   (OUT/'browser-results.json').write_text(json.dumps(RESULT,indent=2));browser.close()
 print(json.dumps({'checks':len(RESULT['checks']),'screenshots':len(RESULT['screenshots']),'errors':RESULT['errors'],'failure':RESULT.get('failure')},indent=2))
if __name__=='__main__':run('--first' in sys.argv)
