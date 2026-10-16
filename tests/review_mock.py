"""只模擬 AI 覆核的傳輸契約；英文品質另由審核清單與歧義拒用測試驗證。"""
import json,re
def mock_review(route,prompt,forms=False):
    if 'Items JSON:\n' not in prompt:return False
    reviews=[]
    for item in json.loads(prompt.split('Items JSON:\n')[1]):
        if forms:answer=next(x for x in item['options'] if x in ['negotiate','procurement'])
        else:answer=re.search(r'\(ref (\w+)\)',item['sentence']).group(1)[::-1]
        reviews.append({'id':item['id'],'validIndexes':[item['options'].index(answer)],
            'reasons':['測試用的逐選項說明，不代表語文審核。']*4,'translationConsistent':True})
    route.fulfill(content_type='application/json',body=json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps({'reviews':reviews})}]},'finishReason':'STOP'}]}))
    return True
