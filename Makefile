all: web/lollipop.js

%.js: node_modules tsconfig.json %.ts
	node_modules/.bin/tsc

node_modules: package.json
	npm install
	touch node_modules
