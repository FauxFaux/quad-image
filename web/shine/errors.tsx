import { Component, h } from 'preact';

interface Props {
  errors: string[];
}

export class Errors extends Component<Props> {
  constructor(props) {
    super(props);
  }

  render(props) {
    return (
      <div class="errors">
        {props.errors.map((msg) => (
          <p>{msg}</p>
        ))}
      </div>
    );
  }
}
