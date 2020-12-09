import { Stories } from '../../../story/stories.collection';
import BotResponses from '../../botResponses/botResponses.model';
import { indexStory } from '../../../story/stories.index';
import Examples from '../../examples/examples.model.js';

const combineSearches = (search, responseKeys, intents) => {
    const searchRegex = [search];
    if (responseKeys.length) searchRegex.push(responseKeys.join('|'));
    if (intents.length) searchRegex.push(intents.join('|'));
    return searchRegex.join('|');
};

// eslint-disable-next-line no-useless-escape
const escape = string => string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

export const searchStories = async (projectId, language, search) => {
    const escapedSearch = escape(search);
    const searchRegex = new RegExp(escape(search), 'i');
    const modelExamples = await Examples.find({
        projectId,
        'metadata.language': language,
    }).lean();
    const intents = modelExamples.reduce((filtered, option) => {
        if (searchRegex.test(option.text)) {
            return [...filtered, option.intent];
        }
        return filtered;
    }, []);
    const matchedResponses = await BotResponses.find({
        textIndex: { $regex: escapedSearch, $options: 'i' },
    }).lean();
    const responseKeys = matchedResponses.map(({ key }) => key);
    const fullSearch = combineSearches(escapedSearch, responseKeys, intents);
    const storiesFilter = {
        projectId,
        $or: [
            { title: { $regex: fullSearch, $options: 'i' } },
            { textIndex: { $regex: fullSearch, $options: 'i' } },
        ],
    };
    const matched = Stories.find(storiesFilter, {
        fields: {
            _id: 1,
            title: 1,
            storyGroupId: 1,
            type: 1,
        },
    }).fetch();
    return { dialogueFragments: matched };
};

const traverseReplaceLine = (story, lineToReplace, newLine) => {
    const updatedStory = story;
    (story.steps || []).forEach(({ action }, i) => {
        if (action === lineToReplace) updatedStory.steps[i].action = newLine;
    });
    (updatedStory.branches || []).forEach(branch => traverseReplaceLine(branch, lineToReplace, newLine));
    return updatedStory;
};

export const replaceStoryLines = (projectId, lineToReplace, newLine) => {
    const matchingStories = Stories.find(
        {
            projectId,
            textIndex: { $regex: escape(lineToReplace) },
        },
        { fields: { _id: 1 } },
    ).fetch();
    return Promise.all(
        matchingStories.map(({ _id }) => {
            const story = Stories.findOne({ _id });
            const { _id: excludeId, ...rest } = traverseReplaceLine(
                story,
                lineToReplace,
                newLine,
            );
            return Stories.update({ _id }, { $set: { ...rest, ...indexStory(rest) } });
        }),
    );
};

export const updateTestResults = async (testResults) => {
    Meteor.call('stories.update', testResults);
};
