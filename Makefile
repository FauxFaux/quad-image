all: web/gallery/gallery.js

%.js: node_modules tsconfig.json %.ts
	node_modules/.bin/tsc $*.ts

node_modules: package.json
	npm install
	touch node_modules
