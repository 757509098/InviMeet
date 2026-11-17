#include "asr_bridge.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sherpa-onnx/c-api/c-api.h>

void *asr_recognizer_create(const char *model_path, const char *tokens_path, int num_threads) {
    if (!model_path || !tokens_path) {
        return NULL;
    }

    SherpaOnnxOfflineRecognizerConfig config;
    memset(&config, 0, sizeof(config));

    config.feat_config.sample_rate = 16000;
    config.feat_config.feature_dim = 80;

    config.model_config.tokens = tokens_path;
    config.model_config.num_threads = num_threads > 0 ? num_threads : 3;
    config.model_config.debug = 0;
    config.model_config.provider = "cpu";
    config.model_config.sense_voice.model = model_path;
    config.model_config.sense_voice.language = "auto";
    config.model_config.sense_voice.use_itn = 1;
    config.decoding_method = "greedy_search";

    const SherpaOnnxOfflineRecognizer *recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
    return (void *)recognizer;
}

char *asr_recognizer_transcribe(void *recognizer, const float *samples, int num_samples, int sample_rate) {
    if (!recognizer || !samples || num_samples <= 0) {
        return NULL;
    }

    const SherpaOnnxOfflineRecognizer *rec = (const SherpaOnnxOfflineRecognizer *)recognizer;
    const SherpaOnnxOfflineStream *stream = SherpaOnnxCreateOfflineStream(rec);
    if (!stream) {
        return NULL;
    }

    int sr = sample_rate > 0 ? sample_rate : 16000;
    SherpaOnnxAcceptWaveformOffline(stream, sr, samples, num_samples);
    SherpaOnnxDecodeOfflineStream(rec, stream);

    const SherpaOnnxOfflineRecognizerResult *result = SherpaOnnxGetOfflineStreamResult(stream);
    char *text_copy = NULL;
    if (result && result->text) {
        text_copy = strdup(result->text);
    }

    if (result) {
        SherpaOnnxDestroyOfflineRecognizerResult(result);
    }
    SherpaOnnxDestroyOfflineStream(stream);

    return text_copy;
}

void asr_recognizer_free_string(char *str) {
    if (str) {
        free(str);
    }
}

void asr_recognizer_destroy(void *recognizer) {
    if (recognizer) {
        SherpaOnnxDestroyOfflineRecognizer((const SherpaOnnxOfflineRecognizer *)recognizer);
    }
}
