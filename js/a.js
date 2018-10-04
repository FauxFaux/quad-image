"use strict";
function ponies(a) {
    var ret = '';
    for (var _i = 0, a_1 = a; _i < a_1.length; _i++) {
        var b = a_1[_i];
        ret += b;
    }
    $.get('http://google.com')
        .then(function (response) { return console.log(response); })
        .catch(function (error) { return console.log(error); });
    return ret;
}
