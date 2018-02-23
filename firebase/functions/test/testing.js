'use strict';

const utils = require('utils');

describe('Happy Dog', () => {
    before(utils.mockDb());

    // Restoring our stubs to the original methods.
    after(utils.unMockDb());


    it('Welcome message', (done) => {
        utils.assertReaction(
            '123',
            'intent.welcom',
            [],
            "Oh, my god! You are here! I'm your loyal pet $knowledge.pet_name. I'm here to make you company and have fun together. What's your name?",
            "Hello hello! My name is $knowledge.pet_name. I'm here to make you company and have fun together. May I know your name?");
    })
});





