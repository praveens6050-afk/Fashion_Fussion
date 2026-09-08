from pathlib import Path

FILES = [Path('account.html'), Path('account-dashboard.js')]

for path in FILES:
    text = path.read_text(encoding='utf-8')
    before = text

    text = text.replace('Fashion_FUSSION', 'Fashion_Fussion')

    if path.name == 'account.html':
        if '<title>My Account | Fashion_Fussion</title>' not in text:
            raise RuntimeError('Account title branding was not normalized')
        if 'Fashion<span>_FUSSION</span>' in text:
            raise RuntimeError('Old account header branding remains')
        if 'Fashion<span>_Fussion</span>' not in text:
            raise RuntimeError('Expected account header branding not found after patch')

    if path.name == 'account-dashboard.js':
        if 'Fashion_FUSSION account' in text:
            raise RuntimeError('Old dashboard branding remains')
        if 'Fashion_Fussion account' not in text:
            raise RuntimeError('Expected dashboard branding not found after patch')

    if text != before:
        path.write_text(text, encoding='utf-8')

print('Account branding normalized safely.')
