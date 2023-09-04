import { Component } from 'preact';
import Router from 'preact-router';
import { createHashHistory } from 'history';
import { Home } from './home';

import './main.css';

export class App extends Component {
  render() {
    return (
      <Router history={createHashHistory() as any}>
        <Home path="/" />
      </Router>
    );
  }
}
