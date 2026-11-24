#!/usr/bin/env python3
#
# Adds OStore-style zigbert META-INF to a KaiOS app zip so it passes the
# apps-service FORMAT check. Copies a reference KaiStore zigbert.rsa and patches
# its messageDigest to SHA-1(our .sf): the chain is internally consistent but the
# RSA is NOT cryptographically valid. Installs only on builds that skip the crypto
# check (this Nokia 2780 build does). Technique: kaios-t9-wizard/docs/ostore-release.md.
#
"""Adds OStore-style META-INF to a KaiOS app ZIP (copies CMS metadata; does NOT
create a valid new signature). usage: add_meta_inf.py <app.zip> <ref-zigbert.rsa> <out.zip>"""
import base64, hashlib, shutil, sys, zipfile
app_zip, ref_rsa_path, out_zip = sys.argv[1:4]
CRLF = '\r\n'
def b64sha1(data): return base64.b64encode(hashlib.sha1(data).digest()).decode()
with zipfile.ZipFile(app_zip) as z:
    names = z.namelist()
    if any(n.startswith('META-INF/') for n in names):
        sys.exit('input already has META-INF/ -- start from the plain app ZIP')
    mf = 'Manifest-Version: 1.0' + CRLF + CRLF
    for n in names:
        data = b'' if n.endswith('/') else z.read(n)
        mf += 'Name: ' + n + CRLF + 'Digest-Algorithms: SHA1' + CRLF + 'SHA1-Digest: ' + b64sha1(data) + CRLF + CRLF
mf = mf.encode()
sf = ('Signature-Version: 1.0' + CRLF + 'SHA1-Digest-Manifest: ' + b64sha1(mf) + CRLF + CRLF).encode()
rsa = open(ref_rsa_path, 'rb').read()
old = None
for i in range(len(rsa) - 22):
    if rsa[i] == 0x04 and rsa[i + 1] == 0x14 and rsa[i - 2:i] == b'\x31\x16':
        old = rsa[i + 2:i + 22]; break
if old is None or rsa.count(old) != 1:
    sys.exit('could not find a unique messageDigest in the reference zigbert.rsa')
rsa = rsa.replace(old, hashlib.sha1(sf).digest())
shutil.copyfile(app_zip, out_zip)
with zipfile.ZipFile(out_zip, 'a', compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('META-INF/zigbert.rsa', rsa)
    z.writestr('META-INF/zigbert.sf', sf)
    z.writestr('META-INF/manifest.mf', mf)
print('wrote', out_zip)
