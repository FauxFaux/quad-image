
function ponies(a: string[]) {
    let ret = '';
    for (const b of a) {
        ret += b;
    }

    $.get('http://google.com')
        .then(response => console.log(response))
        .catch(error => console.log(error));

    return ret;
}
