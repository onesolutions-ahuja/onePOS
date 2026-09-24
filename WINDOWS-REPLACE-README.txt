onePOS Windows replacement source

This package contains the post-Batch-12 source prepared for a Windows project folder.
It contains NO Linux node_modules, NO dist build, NO .git folder, and NO .env/secrets.
Linux compatibility symlinks have been converted to normal files/folders so Windows can extract it normally.

Recommended replacement:
1. Back up your existing onePOS folder.
2. Keep your own .env file separately.
3. Extract this ZIP over/into your onePOS project folder and replace matching source files.
4. Delete your old node_modules and dist folders.
5. In PowerShell from the project folder run:
      npm install
      npm run build
      npm test
6. Restore/use your own .env; do not copy credentials into source control.

Because node_modules is intentionally excluded, npm install on YOUR Windows PC will install the correct Windows native packages rather than Linux binaries.
