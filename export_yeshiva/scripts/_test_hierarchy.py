import sys, json
sys.path.insert(0, 'scripts')
from import_yeshiva_to_categories import (
    build_card, extract_daf_amud,
    daf_category_name, amud_category_name, amud_tag, PATH_SEP
)
MASECHET = 'ברכות'
UNCAT_NAME = f'{MASECHET}{PATH_SEP}ללא סיווג'

q_alef = {'question': 'הקטר חלבים ואיברים (ב. )', 'answers': ['א','ב','ג'], 'correct_index': 0}
q_bet  = {'question': 'שאלה על גמרא (ב:)',         'answers': ['א','ב'],     'correct_index': 1}
group  = {'title': 'דפים ב-יז', 'mekorot': ''}

for q in [q_alef, q_bet]:
    daf_info = extract_daf_amud(q['question'])
    if daf_info:
        daf, amud_val = daf_info
        cat = amud_category_name('ברכות', daf, amud_val)
        card = build_card(q, group, 'ברכות', 'u', 'd', cat, amud_val)
        tags = json.loads(card['tags'])
        print('cat tags:', [t for t in tags if t.startswith('cat:')])
        print('amud tags:', [t for t in tags if t.startswith('\u05e2')])
        print()

print('--- שמות קטגוריות שייווצרו ---')
print('דף:  ', daf_category_name('ברכות', 'ב'))
print('עמוד א:', amud_category_name('ברכות', 'ב', 'א'))
print('עמוד ב:', amud_category_name('ברכות', 'ב', 'ב'))
print()
print('--- displayCategoryName יציג ---')
for name in [daf_category_name('ברכות','ב'), amud_category_name('ברכות','ב','\u05d0'), amud_category_name('ברכות','ב','\u05d1')]:
    display = name.split(PATH_SEP)[-1]
    print(f'  "{name}" -> "{display}"')
