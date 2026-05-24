import requests
from bs4 import BeautifulSoup
import time
import urllib.parse
import sys

# Ensure UTF-8 output
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

queries = [
    'נביא בגרות שאלות ותשובות',
    'תנ"ך משרד החינוך מבחנים',
    'שאלות אמריקאיות תנ"ך'
]

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

urls = set()

def get_duckduckgo_results(query):
    # Try the non-js version which is often more stable for requests
    url = f'https://duckduckgo.com/html/?q={urllib.parse.quote(query)}'
    try:
        response = requests.get(url, headers=headers, timeout=12)
        print(f"Status for {query}: {response.status_code}")
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            links = soup.find_all('a', class_='result__a')
            print(f"Found {len(links)} links for {query}")
            for a in links:
                link = a['href']
                if 'duckduckgo.com/l/?u=' in link:
                    link = urllib.parse.unquote(link.split('u=')[1].split('&')[0])
                urls.add(link)
    except Exception as e:
        print(f"Error searching for {query}: {e}")

for q in queries:
    get_duckduckgo_results(q)
    time.sleep(1)

# Fallback: manually check some known domains if search fails
if not urls:
    print("Search failed to find results. Adding known domains.")
    urls.update([
        "https://pop.education.gov.il/programmes-study/bible/middle-school/learning-materials/",
        "https://www.daat.ac.il/daat/tanach/mivchanim/mivchanim.htm",
        "https://meyda.education.gov.il/tsunami/scripts/alon.asp?kod_miktsoa=2000",
        "https://www.herzog.ac.il/tanach/",
        "https://www.fxp.co.il/forumdisplay.php?f=464"
    ])

results = []
for url in list(urls)[:20]:
    if not url.startswith('http'): continue
    try:
        res = requests.get(url, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, 'html.parser')
        title = soup.title.string.strip() if soup.title else url
        
        source_type = 'professional'
        if 'edu.gov.il' in url: source_type = 'official (Ministry of Ed)'
        elif any(x in url for x in ['daat', 'herzog']): source_type = 'professional/academic'
        
        format_val = 'quiz/worksheet'
        if '.pdf' in url.lower(): format_val = 'pdf'
        
        results.append({'url': url, 'title': title, 'type': source_type, 'format': format_val, 'status': res.status_code})
    except:
        continue

print("\n--- RANKED SHORTLIST ---")
for i, r in enumerate(results):
    print(f"{i+1}. {r['title']} | {r['url']} | {r['type']} | {r['format']}")
