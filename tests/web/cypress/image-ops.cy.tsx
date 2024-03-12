import { supportsWebP } from '../../../web/locket/resize';

describe('image ops', () => {
  it('supports webp', async () => {
    expect(await supportsWebP()).to.be.true;
  });
});
