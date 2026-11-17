#ifndef ASR_BRIDGE_H
#define ASR_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize and create a resident SenseVoice offline recognizer instance in memory.
 * @param model_path Path to model.int8.onnx or model.onnx
 * @param tokens_path Path to tokens.txt
 * @param num_threads Number of computation threads (e.g. 2-4)
 * @return Opaque pointer to the recognizer, or NULL on failure.
 */
void *asr_recognizer_create(const char *model_path, const char *tokens_path, int num_threads);

/**
 * @brief Transcribe in-memory PCM float32 samples with the resident recognizer.
 * @param recognizer Opaque pointer returned by asr_recognizer_create.
 * @param samples Array of normalized float32 audio samples in [-1.0, 1.0].
 * @param num_samples Number of audio samples in the array.
 * @param sample_rate Audio sample rate (e.g. 16000).
 * @return Heap-allocated UTF-8 string containing recognized text, or NULL on failure.
 *         Must be freed with asr_recognizer_free_string().
 */
char *asr_recognizer_transcribe(void *recognizer, const float *samples, int num_samples, int sample_rate);

/**
 * @brief Free a string returned by asr_recognizer_transcribe.
 */
void asr_recognizer_free_string(char *str);

/**
 * @brief Destroy the resident recognizer and release its memory.
 */
void asr_recognizer_destroy(void *recognizer);

#ifdef __cplusplus
}
#endif

#endif // ASR_BRIDGE_H
