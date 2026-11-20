import re, json, sys
src, out_path = sys.argv[1], sys.argv[2]
raw = open(src, encoding='utf-8').read()
# Word 域代码残留：HYPERLINK "url" \l "x" \t "_blank" 与 PAGE \* MERGEFORMAT
raw = re.sub(r'\s*HYPERLINK\s+"[^"]*"(\s+\\[a-z]\s+"[^"]*")*\s*', '', raw)
raw = re.sub(r'PAGE\s+\\\*\s*MERGEFORMAT\d*', '', raw)
lines = raw.split('\n')
KEYS = [('info','案例信息'),('facts','基本案情'),('facts','案情简介'),('issues','法律问题'),('issues','争议焦点'),
        ('holding','裁判要旨'),('holding','判决要旨'),('analysis','法理分析'),('ext','拓展案例')]
def header(l):
    t = re.sub(r'\s+', '', l)
    t = t.strip('【】[]〔〕')
    t = re.sub(r'^[（(]?[一二三四五六七八九十0-9]+[)）、.．]', '', t).strip('【】[]：:')
    t = re.sub(r'[（(].*$', '', t)
    if len(t) > 8: return None
    for k, h in KEYS:
        if t.startswith(h): return k
    return None
# 正文起点：目录之后第二次出现"第一章"
starts = [i for i,l in enumerate(lines) if re.match(r'^\s*第一章\s', l)]
body = starts[1] if len(starts) > 1 else 0
chapter = ''; blocks = []; cur = None
for i in range(body, len(lines)):
    l = lines[i]; s = l.strip()
    m = re.match(r'^第([一二三四五六七八九十]+)章\s*(.+)$', s)
    if m and len(s) < 40: chapter = re.sub(r'\s+', ' ', s); continue
    m = re.match(r'^案例\s*(\d+)\s*[：:]\s*(.+)$', s)
    if m:
        if cur: blocks.append(cur)
        cur = {'chapter': chapter, 'no': int(m.group(1)), 'title': re.sub(r'[（(]?\d+字?[)）]?\s*$', '', m.group(2)).strip(), 'line': i+1, 'sec': 'info', 'raw': {k: [] for k in ['info','facts','issues','holding','analysis','ext']}}
        continue
    if cur is None: continue
    if re.match(r'^案例\s*\d+\s*$', s): continue
    h = header(l)
    if h:
        cur['sec'] = h
        rest = re.split(r'[】:：]', s, maxsplit=1)
        if len(rest) == 2 and rest[1].strip() and len(re.sub(r'\s','',rest[0])) <= 12: cur['raw'][h].append(rest[1])
        continue
    mi = re.match(r'^[【]?\s*[一二三四五六]\s*[、.．]\s*(基本案情|法律问题|裁判要旨|法理分析|拓展案例)\s*[】：:]?\s*(.*)$', s)
    if mi:
        k = {'基本案情':'facts','法律问题':'issues','裁判要旨':'holding','法理分析':'analysis','拓展案例':'ext'}[mi.group(1)]
        cur['sec'] = k
        if mi.group(2).strip(): cur['raw'][k].append(mi.group(2))
        continue
    cur['raw'][cur['sec']].append(l)
if cur: blocks.append(cur)
out = []
for b in blocks:
    t = {k: '\n'.join(v).strip() for k, v in b['raw'].items()}
    t['ext'] = re.split(r'\n\s*\n\s*\n', t['ext'])[0].strip()
    if len(t['ext']) > 3000: t['ext'] = t['ext'][:3000]
    info = t['info']
    nm = re.sub(r'^案例名称\s*[:：]?\s*', '', info.split('\n')[0] if info else '').strip()
    if not nm and info: nm = info.split('\n')[1].strip() if len(info.split('\n'))>1 else ''
    m = re.search(r'[（(]\s*\d{4}\s*[)）][^\s，,:：。]{0,20}?号', info + ' ' + b['title'])
    out.append({'chapter': b['chapter'], 'no': b['no'], 'title': b['title'], 'line': b['line'], 'caseName': nm, 'caseNo': m.group(0) if m else '',
                'infoRaw': info, 'facts': t['facts'], 'issues': t['issues'], 'holding': t['holding'], 'analysis': t['analysis'], 'ext': t['ext']})
json.dump(out, open(out_path, 'w'), ensure_ascii=False, indent=1)
print('cases', len(out))
for i, c in enumerate(out):
    L = {k: len(c[k]) for k in ['facts','issues','holding','analysis','ext']}
    print(i, c['chapter'][:14], '|', c['title'][:22], '|', c['caseName'][:30], '|', c['caseNo'], '|', L)
