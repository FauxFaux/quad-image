%.js: node_modules %.ts
	node_modules/.bin/tsc $*.ts

node_modules: package.json
	npm install
