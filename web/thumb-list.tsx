import { Component } from 'preact';

interface ThumbProps {
  items: string[];
}
interface ThumbState {}

export class ThumbList extends Component<ThumbProps, ThumbState> {
  render(props: Readonly<ThumbProps>, state: Readonly<ThumbState>) {
    return (
      <ul>
        {props.items.map((bare) => (
          <li>
            <img src={`${bare}.thumb.jpg`} />
          </li>
        ))}
      </ul>
    );
  }
}
