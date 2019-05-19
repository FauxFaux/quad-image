all: web/lollipop.js

%.js: node_modules tsconfig.json %.ts
	npm run build

node_modules: package.json
	npm install
	touch node_modules
