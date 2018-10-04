
out.js: node_modules bundle.js
	NODE_ENV=production node_modules/.bin/babel bundle.js > out.js

bundle.js: node_modules a.js
	node_modules/.bin/rollup --config

node_modules: package.json
	npm install
